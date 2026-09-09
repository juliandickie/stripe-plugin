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
//   An EMPTY decision (no opinion, so Claude Code's own permission flow
//   decides) must be EARNED by proving the command is a SINGLE, SIMPLE,
//   read-only engine invocation. The helper is still called defer().
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
const {issue: issueVet, canonicalKey} = require('../src/vetting');
const {classifyCliSub} = require('../src/cli_bridge');

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

// No opinion. Emit NO permissionDecision at all, so Claude Code's normal
// permission flow decides (a prompt in prompting modes, the classifier in
// auto mode, straight through in bypass mode).
//
// This used to return the literal value 'defer'. Claude Code 2.1.260 began
// honouring 'defer' as "park this tool call in the user's deferred-tool
// queue for a later decision", which in auto and bypass modes never resolves,
// so EVERY non-Stripe Bash command in every session hung with no result
// (2026-09-10, found in a Claude Code Desktop session; transcript showed a
// hook_deferred_tool attachment and no tool_result for each Bash call).
// The name is kept so the classifier above reads unchanged.
function defer() {
  return {};
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

// A STRICT, SEPARATE parse whose only job is to name the operation for
// src/vetting.js. It is deliberately NOT wired into _decide.
//
// _decide's fallbacks are not interchangeable - "more than one invocation"
// asks, an unproven-simple command denies, an unlocatable engine token asks -
// and those distinctions are what nine bypasses were spent establishing.
// Folding this parse into it would collapse them into one null result and put
// a proven classifier at risk for a cosmetic gain.
//
// The duplication is bounded in the safe direction. If this parse and _decide
// ever disagree, the effect is that no token is issued and the engine refuses
// a legitimate live call. It can never authorise one _decide would have
// stopped, because a token is only ever issued when _decide has already
// declined to deny.
//
// Returns null whenever the operation cannot be named with certainty.
function parseEngineCommand(cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) return null;
  // Only a command drawn entirely from the safe character set can be
  // tokenized by splitting on whitespace. Anything else may be rewritten by
  // the shell before the engine sees it, so it cannot be named.
  if (!SIMPLE_CHARS.test(cmd)) return null;
  const normalized = normalize(cmd);
  if (countEngineMentions(normalized) !== 1) return null;

  const tokens = cmd.trim().split(/\s+/);
  const i = tokens.findIndex(isEngineToken);
  if (i === -1) return null;

  const out = {account: '', accountsFile: '', id: '', bulkIds: '', live: false, arm: false};
  const positional = [];
  const rest = tokens.slice(i + 1);
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (t.charAt(0) === '-') {
      if (VALUE_FLAGS.has(t)) {
        const v = rest[++j];
        if (v === undefined) return null;
        if (t === '--account') out.account = v;
        else if (t === '--accounts-file') out.accountsFile = v;
        else if (t === '--id') out.id = v;
        else if (t === '--bulk-ids') out.bulkIds = v;
        continue;
      }
      // An unrecognised flag means this parse and src/cli.js's parseArgs
      // would disagree about which tokens are positional. Refuse to guess.
      if (!BOOLEAN_FLAGS.has(t)) return null;
      if (t === '--live') out.live = true;
      else if (t === '--arm-live') out.arm = true;
      continue;
    }
    positional.push(t);
  }

  const resource = positional[0];
  const action = positional[1];
  if (!resource || !IDENTIFIER.test(resource)) return null;
  if (!action || !IDENTIFIER.test(action)) return null;
  out.resource = resource;
  out.action = action;
  return out;
}

// The key for an invocation, or null when the engine will not demand one.
//
// Issuing only for operations the engine actually gates keeps the token
// directory small and, more importantly, keeps the number of live tokens in
// existence at any moment as close to zero as the work allows. A read never
// mints anything that a later write could ride.
function vettingKeyFor(input) {
  if (!mentionsEngine(input)) return null;
  const op = parseEngineCommand(input.tool_input.command);
  if (!op) return null;
  // Vetting is a live-money control; the engine consults it nowhere else.
  if (!op.live) return null;
  // Neither reaches a gated operation, and both are checked BEFORE the arm
  // branch below: `stripe-x vet ... --arm-live` would otherwise mint a token
  // keyed on the literal resource "vet", which names no real operation.
  if (op.resource === 'help' || op.resource === 'vet') return null;
  // Arming is gated in its own right, and its key is distinct from the
  // execution key, so approving an arm never approves the execution.
  if (op.arm) return canonicalKey(op);
  const cls = op.resource === 'cli'
    ? classifyCliSub(op.action)
    : classify(camelizePath(op.resource).split('.').pop(), op.action);
  if (cls === 'read') return null;
  return canonicalKey(op);
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
  // modes) or an `ask` the user goes on to approve - must still be able to
  // run its live operation, and src/vetting.js refuses a live call carrying
  // no token for that operation. Only `deny` withholds one. This happens
  // here, after the decision is computed, never inside _decide, so _decide
  // stays a pure classifier and every side effect of this module lives in
  // one place.
  //
  // The token names one operation. vettingKeyFor returns null for anything
  // the engine will not gate, and for anything this module cannot parse with
  // certainty, so an invocation assembled at runtime mints nothing and a
  // routine read mints nothing a later write could ride.
  if (result.permissionDecision !== 'deny' && environment.CLAUDE_PLUGIN_DATA) {
    // Require CLAUDE_PLUGIN_DATA before writing: with it unset there is no
    // coordinated location for the token, and writing to a relative path
    // would litter the repository instead. The decision computed above is
    // already final and correct on its own; issuing a token is an
    // additional, independent guarantee for src/vetting.js, not part of
    // that decision, so a write failure here is scoped to its own
    // try/catch and is not allowed to alter or throw past the decision.
    try {
      const key = vettingKeyFor(input);
      if (key) issueVet(environment, key);
    } catch (e) {
      // Deliberately empty: see comment above.
    }
  }

  return result;
}

function emit(d) {
  // An empty decision is emitted as an empty object, which the hook contract
  // reads as "this hook has nothing to say". Wrapping it in hookSpecificOutput
  // with no permissionDecision would also be tolerated, but an empty object is
  // the documented no-op and cannot be misread by a future version.
  const out = Object.keys(d).length === 0
    ? {}
    : {hookSpecificOutput: Object.assign({hookEventName: 'PreToolUse'}, d)};
  process.stdout.write(JSON.stringify(out));
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

module.exports = {decide, mentionsEngine, parseEngineCommand, vettingKeyFor, VALUE_FLAGS, BOOLEAN_FLAGS};
