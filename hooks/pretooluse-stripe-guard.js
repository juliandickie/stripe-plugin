#!/usr/bin/env node
'use strict';
// PreToolUse guard for the stripe-x engine.
//
// This guard decides whether a Bash command that invokes the stripe-x engine
// may run unattended while Claude Code is in a permission mode that does not
// otherwise prompt. It is the only boundary between an agent's decision and a
// real Stripe money movement, because every gate the engine itself owns is
// opened by a flag the calling agent writes.
//
// THE INVARIANT
//
//   `defer` must be EARNED by proving the command is a SINGLE, SIMPLE,
//   read-only engine invocation.
//   Anything whose reduced text looks live -> deny.
//   Anything that cannot be proven simple  -> ask.
//
// WHY THIS IS AN ALLOWLIST, AND WHY THAT MATTERS
//
// Eight distinct bypasses were found in earlier versions of this file. Every
// one of them was the same mistake in a new costume: the guard enumerated
// shell constructs it considered dangerous, and the shell had another one.
//
//   1-3. quoting hid the engine name or a flag   (eval "...", bash -c "...", "stripe-x")
//   4.   quote and backslash splicing            (--li"ve", --li\ve reassemble to --live)
//   5.   a case-insensitive filesystem           (STRIPE-X runs the same binary)
//   6.   a chained second invocation             (cmd | stripe-x accounts del ...)
//   7.   ANSI-C quoting                          (--li$'v'e reconstructs to --live)
//   8.   redirection shifting argv               (stripe-x > list accounts del ...
//                                                 actually execs `stripe-x accounts del ...`)
//
// So the simplicity test is no longer "does this contain a bad character".
// It is "is EVERY character in this command drawn from a small safe set".
// A construct nobody has thought of yet contains something outside that set
// and therefore fails closed on its own, without needing to be discovered
// and patched first. That is the difference between a guard that is
// currently correct and one that is structurally correct.
const {classify} = require('../src/classify');
const {camelizePath} = require('../src/dispatch');
const {issue: issueVet} = require('../src/vetting');

const ENGINE = 'stripe-x';

// Modes in which the user already sees a permission prompt. Anything not
// listed here, including an unrecognised future mode, is treated as
// non-prompting, which is the fail-closed direction.
const PROMPTING = new Set(['default', 'plan', 'acceptEdits']);

// Flags that consume the following token as their value. Mirrors parseArgs in
// src/cli.js; test/hook_guard.test.js asserts the two stay in sync.
const VALUE_FLAGS = new Set(['--account', '--id', '--params', '--data', '--expand',
  '--limit', '--idempotency-key', '--api-version', '--bulk-ids', '--accounts-file']);

// Flags the engine recognises that take no value. Any other hyphen-prefixed
// token is positional to the real parseArgs but would be skipped here, so the
// two would disagree about the resource and action. We refuse to guess.
const BOOLEAN_FLAGS = new Set(['--live', '--confirm', '--confirm-bulk', '--arm-live',
  '--all', '--table']);

// The allowlist. Letters, digits, space, and the punctuation that legitimately
// appears in engine arguments: underscore and hyphen in flags and ids, dot and
// slash in paths and resource paths, comma in list values, equals in --data
// pairs, colon in env:/op:// references, at-sign and plus in email values.
// Everything else - quotes, backslash, dollar, backtick, pipe, ampersand,
// semicolon, angle brackets, parentheses, braces, newline, glob characters -
// means the command cannot be proven simple.
const SIMPLE_CHARS = /^[A-Za-z0-9 _\-./,=:@+]*$/;

// A resource or action must look like an identifier before it is trusted
// enough to classify. Defence in depth behind SIMPLE_CHARS: bypass 8 worked
// precisely because a redirection operator landed in the resource slot and
// classify() only inspects the action.
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.]*$/;

function defer() {
  return {permissionDecision: 'defer'};
}

function deny(reason) {
  return {permissionDecision: 'deny', permissionDecisionReason: reason};
}

function ask(reason) {
  return {permissionDecision: 'ask', permissionDecisionReason: reason};
}

// Approximates shell quote removal, escape removal, expansion syntax and a
// case-folding filesystem, so --li"ve", --li\ve, --li$'v'e and --LIVE all
// collapse to the same text the live check tests against.
function normalize(cmd) {
  return cmd.replace(/['"\\$]/g, '').toLowerCase();
}

// Did this hook input mention the engine at all? Reuses normalize() rather
// than re-implementing the substring check, so this and _decide's own
// mention gate (the first real test _decide runs once it has a command
// string) can never disagree. decide() uses this to gate vetting-token
// issuance, which must happen outside _decide - see decide() below.
//
// Requires the same hook_event_name === 'PreToolUse' and tool_name === 'Bash'
// conditions _decide checks first. hooks.json only ever invokes this hook
// for that combination, so in production _decide already returns defer()
// before reaching anything event/tool-specific - but decide()'s issuance
// check runs on ANY non-deny result, including that early defer(), so
// without this gate a non-PreToolUse or non-Bash input whose command text
// happens to mention the engine would still mint a token. Requiring the
// same conditions here closes that gap rather than relying on hooks.json
// alone to keep it unreachable.
function mentionsEngine(input) {
  if (!input || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return false;
  const cmd = input.tool_input && input.tool_input.command;
  if (typeof cmd !== 'string' || cmd.length === 0) return false;
  return normalize(cmd).indexOf(ENGINE) !== -1;
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
  // prompt on its own. Every remaining branch resolves to deny or ask, except
  // the two that positively prove the command is one simple read.

  if (normalized.indexOf('--live') !== -1) {
    return deny('Live Stripe calls are refused while Claude Code is in a non-prompting '
      + 'permission mode. Relaunch in default mode to run this.');
  }

  // The parse below reads the first resource/action pair after the first
  // engine token. Verify, rather than assume, that there is only one
  // invocation for it to be reading.
  if (countEngineMentions(normalized) !== 1) {
    return ask('This command contains more than one Stripe engine invocation, which cannot '
      + 'be verified as a whole while Claude Code is in a non-prompting permission mode. '
      + 'Confirm before running.');
  }

  if (!SIMPLE_CHARS.test(cmd)) {
    return deny('This Stripe command contains shell syntax that cannot be verified, so it '
      + 'cannot be shown to be free of a live operation. Relaunch Claude Code in default '
      + 'permission mode, or rewrite the command without shell quoting or expansion.');
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
      if (!BOOLEAN_FLAGS.has(t)) return unclear;
      continue;
    }
    positional.push(t);
  }

  const resource = positional[0];
  if (!resource || !IDENTIFIER.test(resource)) return unclear;
  // Local discovery against a bundled JSON asset; reaches no network.
  if (resource === 'help') return defer();
  // The bundled Stripe CLI surface is not modelled here.
  if (resource === 'cli') {
    return ask('Stripe CLI bridge while Claude Code is in a non-prompting permission mode. '
      + 'Confirm before running.');
  }
  const action = positional[1];
  if (!action || !IDENTIFIER.test(action)) return unclear;

  const cls = classify(camelizePath(resource).split('.').pop(), action);
  if (cls === 'read') return defer();
  return ask('Stripe ' + cls + ' operation while Claude Code is in a non-prompting '
    + 'permission mode. Confirm before running.');
}

function decide(input, env) {
  const environment = env || process.env;
  // A throwing guard must never fail open.
  let result;
  try {
    result = _decide(input);
  } catch (e) {
    result = deny('Stripe call refused: the permission guard could not evaluate this command.');
  }

  // A recognised stripe-x invocation that is not denied - `defer` (prompting
  // modes, simple reads) or an `ask` the user goes on to approve - must
  // still be able to run a live operation, and src/vetting.js refuses a
  // live call with no token. Only `deny` withholds one. This happens here,
  // after the decision is computed, never inside _decide, so _decide stays
  // a pure classifier and every side effect of this module lives in one
  // place.
  if (result.permissionDecision !== 'deny' && environment.CLAUDE_PLUGIN_DATA
      && mentionsEngine(input)) {
    // Require CLAUDE_PLUGIN_DATA before writing: with it unset there is no
    // coordinated location for the token, and writing to a relative path
    // would litter the repository instead. The decision computed above is
    // already final and correct on its own; issuing a token is an
    // additional, independent guarantee for src/vetting.js, not part of
    // that decision, so a write failure here is scoped to its own
    // try/catch and is not allowed to alter or throw past the decision.
    try {
      issueVet(environment);
    } catch (e) {
      // Deliberately empty: see comment above.
    }
  }

  return result;
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
    emit(decide(input, process.env));
    process.exit(0);
  });
}

module.exports = {decide, mentionsEngine, VALUE_FLAGS, BOOLEAN_FLAGS};
