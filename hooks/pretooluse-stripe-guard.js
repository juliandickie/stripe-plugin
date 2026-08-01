#!/usr/bin/env node
'use strict';
// PreToolUse guard. Refuses live Stripe calls, and escalates Stripe writes
// to a permission prompt, whenever Claude Code is in a mode that does not
// otherwise prompt. This is the boundary the engine cannot provide for
// itself: every engine gate is opened by a flag the caller writes, and the
// caller does not write this hook's input.
const {classify} = require('../src/classify');
const {camelizePath} = require('../src/dispatch');

// Modes in which the user already sees a permission prompt. Anything not
// listed here, including an unrecognised future mode, is treated as
// non-prompting, which is the fail-closed direction.
const PROMPTING = new Set(['default', 'plan', 'acceptEdits']);

// Flags that consume the following token as their value.
const VALUE_FLAGS = new Set(['--account', '--id', '--params', '--data', '--expand',
  '--limit', '--idempotency-key', '--api-version', '--bulk-ids', '--accounts-file']);

// Constructs that could hide a --live flag from a naive token scan. This is
// a pattern match over the untrusted shell-command string, looking for the
// literal word "eval" as a shell token (plus command substitution, chaining,
// and backticks); it never calls JavaScript's eval() on anything.
const AMBIGUOUS = /(\$\(|`|(^|\s)eval(\s|$)|;|&&|\|\|)/;

function defer() { return {permissionDecision: 'defer'}; }
function deny(reason) { return {permissionDecision: 'deny', permissionDecisionReason: reason}; }
function ask(reason) { return {permissionDecision: 'ask', permissionDecisionReason: reason}; }

function isEngineToken(t) {
  return t === 'stripe-x' || t.endsWith('/stripe-x');
}

function _decide(input) {
  if (!input || input.hook_event_name !== 'PreToolUse') return defer();
  if (input.tool_name !== 'Bash') return defer();
  const cmd = (input.tool_input && input.tool_input.command) || '';
  if (typeof cmd !== 'string' || cmd.length === 0) return defer();

  // Cheap substring pre-gate: if the engine name is not mentioned anywhere in
  // the raw command, this call is out of scope. Deliberately a substring
  // test on the raw string, not the strict per-token equality check below -
  // it still fires when the engine name is glued to a quote character by an
  // enclosing eval/backtick/subshell (e.g. `eval "stripe-x ...`), which is
  // exactly the obfuscation the ambiguity check exists to catch. Running a
  // strict-token gate here instead would let that same obfuscation bypass
  // detection entirely, by hiding the engine mention before ambiguity is
  // ever considered.
  if (cmd.indexOf('stripe-x') === -1) return defer();

  const mode = input.permission_mode || 'default';
  if (PROMPTING.has(mode)) return defer();

  // From here the call at least mentions the engine, in a mode that will
  // not prompt on its own. Every remaining uncertainty resolves to the most
  // restrictive outcome, checked before classification.
  if (AMBIGUOUS.test(cmd)) {
    return deny('Stripe call refused: the command contains shell constructs that could '
      + 'conceal flags, and Claude Code is in a non-prompting permission mode.');
  }

  const tokens = cmd.trim().split(/\s+/);
  if (!tokens.some(isEngineToken)) return defer();

  const i = tokens.findIndex(isEngineToken);
  const rest = tokens.slice(i + 1);

  if (rest.includes('--live')) {
    return deny('Live Stripe calls are refused while Claude Code is in a non-prompting '
      + 'permission mode. Relaunch in default mode to run this.');
  }

  const positional = [];
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.startsWith('-')) {
      if (VALUE_FLAGS.has(t)) j++;
      continue;
    }
    positional.push(t);
  }

  const resource = positional[0];
  if (!resource) {
    return deny('Stripe call refused: the operation could not be determined and '
      + 'Claude Code is in a non-prompting permission mode.');
  }
  // Local discovery against a bundled JSON asset; reaches no network.
  if (resource === 'help') return defer();
  // The bundled Stripe CLI surface is not modelled here, so treat it as at
  // least mutating.
  if (resource === 'cli') {
    return ask('Stripe CLI bridge in a non-prompting permission mode; confirm before running.');
  }

  const action = positional[1];
  if (!action) {
    return deny('Stripe call refused: no action was supplied and Claude Code is in a '
      + 'non-prompting permission mode.');
  }

  const segment = camelizePath(resource).split('.').pop();
  const cls = classify(segment, action);
  if (cls === 'read') return defer();
  return ask('Stripe ' + cls + ' operation while Claude Code is in a non-prompting '
    + 'permission mode; confirm before running.');
}

function decide(input) {
  // A throwing guard must never fail open.
  try {
    return _decide(input);
  } catch (e) {
    return deny('Stripe call refused: the permission guard could not evaluate this command.');
  }
}

function emit(d) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: Object.assign({hookEventName: 'PreToolUse'}, d)
  }));
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let input = null;
    try { input = JSON.parse(raw); } catch (e) { input = null; }
    emit(decide(input));
    process.exit(0);
  });
}

module.exports = {decide};
