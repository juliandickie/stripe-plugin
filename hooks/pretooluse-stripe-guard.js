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
// and backticks); it never calls JavaScript's eval() on anything. A nested
// shell invocation (bash/sh/zsh -c "...") can hide a flag inside its command
// string exactly the same way command substitution can - the flag never
// appears as a token of the outer command at all - so it is denied outright
// alongside the other constructs rather than trusted to a token scan.
const AMBIGUOUS = /(\$\(|`|(^|\s)eval(\s|$)|;|&&|\|\||(^|\s)(bash|sh|zsh)\s+-c(\s|$))/;

function defer() { return {permissionDecision: 'defer'}; }
function deny(reason) { return {permissionDecision: 'deny', permissionDecisionReason: reason}; }
function ask(reason) { return {permissionDecision: 'ask', permissionDecisionReason: reason}; }

// A quoting shell glues a leading and/or trailing quote character onto a
// token before this hook ever sees the command split on whitespace
// (`"stripe-x"`, or just `"stripe-x` when the closing quote lands on a
// later word instead). Stripping one layer of surrounding quotes before
// comparing means the engine token and the --live flag are still recognised
// when quoted, rather than silently failing to match.
function stripQuotes(t) {
  return t.replace(/^['"]/, '').replace(/['"]$/, '');
}

function isEngineToken(t) {
  const s = stripQuotes(t);
  return s === 'stripe-x' || s.endsWith('/stripe-x');
}

function isLiveFlag(t) {
  return stripQuotes(t) === '--live';
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
  // not prompt on its own. This is the fail-closed boundary: every branch
  // below must resolve to deny or ask. Past this point, defer is reachable
  // only by successfully locating the engine token and that locate leading
  // to a read classification - never merely because a check above did not
  // fire. That "didn't match, so defer" shape is exactly how a quoted
  // engine token and a nested-shell invocation each bypassed this guard
  // before: the strict token match silently failed to locate the engine,
  // and the code treated "not located" as "not our concern" instead of
  // "cannot rule out danger".
  if (AMBIGUOUS.test(cmd)) {
    return deny('Stripe call refused: the command contains shell constructs that could '
      + 'conceal flags, and Claude Code is in a non-prompting permission mode.');
  }

  const tokens = cmd.trim().split(/\s+/);
  const i = tokens.findIndex(isEngineToken);
  if (i === -1) {
    // The raw command mentions "stripe-x" (the pre-gate above matched) but
    // no token, even after stripping quotes, resolves to the engine itself.
    // Fail closed rather than assuming the mention is incidental.
    return deny('Stripe call refused: the engine could not be located as a distinct '
      + 'token in the command, and Claude Code is in a non-prompting permission mode.');
  }
  const rest = tokens.slice(i + 1);

  if (rest.some(isLiveFlag)) {
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
