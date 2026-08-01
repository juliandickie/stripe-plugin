#!/usr/bin/env node
'use strict';
// PreToolUse guard for the stripe-x engine.
//
// Design note (2026-08-01): this is an ALLOWLIST, and that is deliberate.
// An earlier blocklist version assumed a command was safe and hunted for
// danger. It was defeated five separate times by ordinary shell behaviour:
// --li"ve" reassembles to --live, st"ripe-x" reassembles to stripe-x,
// --li\ve reassembles to --live, and STRIPE-X resolves to the same binary on
// a case-insensitive filesystem. Deciding safety from raw shell text means
// out-guessing the shell, which is not a winnable game. So the invariant is
// inverted:
//
//   `defer` must be EARNED by proving a command is simple and read-only.
//   Anything that looks live      -> deny.
//   Anything merely unparseable   -> ask.
//
// Nothing that touches the engine in a non-prompting mode reaches `defer`
// without passing every check below.
const {classify} = require('../src/classify');
const {camelizePath} = require('../src/dispatch');

const ENGINE = 'stripe-x';

// Modes in which the user already sees a permission prompt. Anything not
// listed here, including an unrecognised future mode, is treated as
// non-prompting, which is the fail-closed direction.
const PROMPTING = new Set(['default', 'plan', 'acceptEdits']);

// Flags that consume the following token as their value. Kept in sync with
// parseArgs in src/cli.js.
const VALUE_FLAGS = new Set(['--account', '--id', '--params', '--data', '--expand',
  '--limit', '--idempotency-key', '--api-version', '--bulk-ids', '--accounts-file']);

// Any match means we cannot reconstruct what the shell will actually run:
// quoting and escaping, parameter or command expansion, chaining, nested
// shells. The `eval`, `bash`, `sh` and `zsh` alternatives below are string
// patterns being matched against the command text, not invocations.
const UNPARSEABLE = /['"\\$`]|(^|\s)eval(\s|$)|;|&&|\|\||(^|\s)(bash|sh|zsh)\s+-/;

function defer() {
  return {permissionDecision: 'defer'};
}

function deny(reason) {
  return {permissionDecision: 'deny', permissionDecisionReason: reason};
}

function ask(reason) {
  return {permissionDecision: 'ask', permissionDecisionReason: reason};
}

// Approximates shell quote removal plus a case-folding filesystem, so that
// --li"ve", --li\ve and --LIVE all collapse to the same text we test against.
// This is the single check that replaces the entire family of shape-specific
// bypass patches the blocklist design kept needing.
function normalize(cmd) {
  return cmd.replace(/['"\\]/g, '').toLowerCase();
}

function isEngineToken(t) {
  const s = t.toLowerCase();
  return s === ENGINE || s.endsWith('/' + ENGINE);
}

function _decide(input) {
  if (!input || input.hook_event_name !== 'PreToolUse') return defer();
  if (input.tool_name !== 'Bash') return defer();
  const cmd = input.tool_input && input.tool_input.command;
  if (typeof cmd !== 'string' || cmd.length === 0) return defer();

  const normalized = normalize(cmd);
  if (normalized.indexOf(ENGINE) === -1) return defer();

  const mode = input.permission_mode || 'default';
  if (PROMPTING.has(mode)) return defer();

  // Past this point the command touches the engine in a mode that will not
  // prompt on its own. Every remaining branch must resolve to deny or ask,
  // except the two that positively prove the command is read-only.

  if (normalized.indexOf('--live') !== -1) {
    return deny('Live Stripe calls are refused while Claude Code is in a non-prompting '
      + 'permission mode. Relaunch in default mode to run this.');
  }

  if (UNPARSEABLE.test(cmd)) {
    return ask('This Stripe command uses shell quoting, expansion or chaining that cannot '
      + 'be verified, and Claude Code is in a non-prompting permission mode. '
      + 'Confirm before running.');
  }

  const tokens = cmd.trim().split(/\s+/);
  const i = tokens.findIndex(isEngineToken);
  if (i === -1) {
    return ask('A Stripe engine invocation could not be located while Claude Code is in a '
      + 'non-prompting permission mode. Confirm before running.');
  }

  const rest = tokens.slice(i + 1);
  const positional = [];
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.charAt(0) === '-') {
      if (VALUE_FLAGS.has(t)) j++;
      continue;
    }
    positional.push(t);
  }

  const unclear = ask('The Stripe operation could not be determined while Claude Code is in '
    + 'a non-prompting permission mode. Confirm before running.');

  const resource = positional[0];
  if (!resource) return unclear;
  // Local discovery against a bundled JSON asset; reaches no network.
  if (resource === 'help') return defer();
  // The bundled Stripe CLI surface is not modelled here.
  if (resource === 'cli') {
    return ask('Stripe CLI bridge while Claude Code is in a non-prompting permission mode. '
      + 'Confirm before running.');
  }
  const action = positional[1];
  if (!action) return unclear;

  const cls = classify(camelizePath(resource).split('.').pop(), action);
  if (cls === 'read') return defer();
  return ask('Stripe ' + cls + ' operation while Claude Code is in a non-prompting '
    + 'permission mode. Confirm before running.');
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
