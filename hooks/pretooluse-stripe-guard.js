#!/usr/bin/env node
'use strict';
// PreToolUse guard for the stripe-x engine.
//
// Design note (2026-08-01): this is an ALLOWLIST, and that is deliberate.
// An earlier blocklist version assumed a command was safe and hunted for
// danger. It was defeated repeatedly by ordinary shell behaviour: --li"ve"
// reassembles to --live, st"ripe-x" to stripe-x, --li\ve to --live, and
// STRIPE-X resolves to the same binary on a case-insensitive filesystem.
// Deciding safety from raw shell text means out-guessing the shell, which is
// not a winnable game. So the invariant is inverted:
//
//   `defer` must be EARNED by proving a command is a single, simple,
//   read-only engine invocation.
//   Anything that looks live     -> deny.
//   Anything merely unparseable  -> ask.
//
// Two assumptions that the earlier version made silently, and that this
// version verifies explicitly, because each one hid a live bypass:
//
//   1. That the text has been reduced the way the shell would reduce it.
//      Handled by normalize(), which folds quotes, backslashes, $ and case
//      before any decision is taken.
//   2. That the command contains exactly ONE engine invocation. The parse
//      below reads the first resource/action pair after the first engine
//      token; a second invocation chained with |, &, or a newline would
//      otherwise be classified by the FIRST command and could reach defer.
//      A chained `stripe-x refunds list | stripe-x accounts del --id X`
//      did exactly that, running a destructive delete with no prompt.
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

// Flags the engine recognises that take no value. Any other hyphen-prefixed
// token means this guard and the real parseArgs would disagree about which
// tokens are positional, so we refuse to guess.
const BOOLEAN_FLAGS = new Set(['--live', '--confirm', '--confirm-bulk', '--arm-live',
  '--all', '--table']);

// Any match means we cannot reconstruct what the shell will actually run:
// quoting and escaping, parameter or command expansion, chaining or
// backgrounding, or a nested shell. The character class covers pipe,
// ampersand, semicolon, newline and carriage return, so both the single and
// doubled forms of the chaining operators are caught. The `eval`, `bash`,
// `sh` and `zsh` alternatives are string patterns matched against command
// text, not code invocations.
const UNPARSEABLE = /['"\\$`]|[|&;\n\r]|(^|\s)eval(\s|$)|(^|\s)(bash|sh|zsh)\s+-/i;

function defer() {
  return {permissionDecision: 'defer'};
}

function deny(reason) {
  return {permissionDecision: 'deny', permissionDecisionReason: reason};
}

function ask(reason) {
  return {permissionDecision: 'ask', permissionDecisionReason: reason};
}

// Approximates shell quote removal, escape removal and a case-folding
// filesystem, so --li"ve", --li\ve, --li$'v'e and --LIVE all collapse to the
// same text we test against. This single reduction replaces the family of
// shape-specific patches the blocklist design kept needing.
function normalize(cmd) {
  return cmd.replace(/['"\\$]/g, '').toLowerCase();
}

function isEngineToken(t) {
  const s = t.toLowerCase();
  return s === ENGINE || s.endsWith('/' + ENGINE);
}

function countEngineMentions(normalized) {
  return normalized.split(ENGINE).length - 1;
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
  // except the two that positively prove the command is one simple read.

  if (normalized.indexOf('--live') !== -1) {
    return deny('Live Stripe calls are refused while Claude Code is in a non-prompting '
      + 'permission mode. Relaunch in default mode to run this.');
  }

  // Verify the single-invocation assumption the parse below depends on.
  if (countEngineMentions(normalized) !== 1) {
    return ask('This command contains more than one Stripe engine invocation, which cannot '
      + 'be verified as a whole while Claude Code is in a non-prompting permission mode. '
      + 'Confirm before running.');
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

  const unclear = ask('The Stripe operation could not be determined while Claude Code is in '
    + 'a non-prompting permission mode. Confirm before running.');

  const rest = tokens.slice(i + 1);
  const positional = [];
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.charAt(0) === '-') {
      if (VALUE_FLAGS.has(t)) {
        j++;
        continue;
      }
      // An unrecognised hyphen-prefixed token is positional to the real
      // parseArgs but would be skipped here, so the two would disagree about
      // what the resource and action are. Refuse to guess.
      if (!BOOLEAN_FLAGS.has(t)) return unclear;
      continue;
    }
    positional.push(t);
  }

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
