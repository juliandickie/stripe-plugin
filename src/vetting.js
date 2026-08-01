'use strict';
// Vetting tokens - proof that a live operation was seen by a permission gate.
//
// WHY THIS EXISTS
//
// The PreToolUse guard classifies a Bash command by reading its text. That
// works until the shell assembles the command at runtime. `A=stri; B=pe-x;
// $A$B refunds create --live` contains no literal "stripe-x" anywhere, so no
// text classifier can recognise it, and the guard correctly-but-uselessly
// defers. Eight earlier bypasses were shapes that could be patched. That one
// cannot be, short of implementing a shell.
//
// So the engine stops relying on the guard to RECOGNISE danger, and instead
// requires positive proof that some permission gate saw the call at all:
//
//   A live mutating or destructive operation requires a vetting token.
//   No token means refusal.
//
// KNOWN GAP, READ BEFORE RELYING ON THIS. The token below is scoped to the
// session and a time window, NOT to the individual call. It proves only that
// some recognised stripe-x invocation happened recently, and ordinary read
// traffic keeps that true almost continuously, so it does not prove that this
// particular operation was seen by a gate. Two consequences follow: an
// obfuscated invocation can still execute while a token from an unrelated
// read is warm, and `--arm-live` returns before the check runs at all.
// Closing this means binding the token to a canonical key that the guard and
// the engine compute independently from the account, resource, action and
// live flag, so a token for `customers list` cannot authorise
// `refunds create --live`. Tracked in docs/SESSION-HANDOFF-2026-08-02.md.
//
// Tokens come from exactly two places:
//   1. The PreToolUse guard, whenever it recognises a stripe-x invocation and
//      does not deny it.
//   2. `stripe-x vet`, which requires a TTY. Claude Code's Bash tool has no
//      controlling terminal, so an agent cannot mint a token this way, while
//      a human at a terminal can. That TTY requirement is what keeps the
//      escape hatch from being an escape hatch for the caller too.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Mirrors src/arming.js: generated once per process so a caller cannot pin
// CLAUDE_SESSION_ID to a fixed sentinel and share vetting state across
// unrelated invocations. The safe direction is under-vetting.
const EPHEMERAL_SID = 'ephemeral-' + crypto.randomUUID();

const DEFAULT_TTL_SECONDS = 300;

function safeSid(env) {
  const raw = env.CLAUDE_SESSION_ID;
  if (!raw) return EPHEMERAL_SID;
  const cleaned = String(raw).replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : EPHEMERAL_SID;
}

function tokenPath(env) {
  const dir = path.join(env.CLAUDE_PLUGIN_DATA || '.', 'stripe-x', 'vetting');
  return {dir: dir, file: path.join(dir, safeSid(env) + '.json')};
}

function ttlMs(env) {
  const parsed = parseInt(env.CLAUDE_PLUGIN_OPTION_VET_TTL || String(DEFAULT_TTL_SECONDS), 10);
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
  return seconds * 1000;
}

// `now` is injectable so tests can exercise expiry without sleeping.
function issue(env, now) {
  const t = tokenPath(env);
  fs.mkdirSync(t.dir, {recursive: true});
  const stamp = typeof now === 'number' ? now : Date.now();
  const tmp = t.file + '.' + process.pid + '.' + stamp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({issued: stamp}));
  fs.renameSync(tmp, t.file);
  return stamp;
}

function isVetted(env, now) {
  const t = tokenPath(env);
  let issued;
  try {
    issued = JSON.parse(fs.readFileSync(t.file, 'utf8')).issued;
  } catch (e) {
    return false;
  }
  if (typeof issued !== 'number' || !Number.isFinite(issued)) return false;
  const at = typeof now === 'number' ? now : Date.now();
  // A token stamped in the future is treated as invalid rather than valid
  // forever, so a clock skew or a crafted file cannot mint permanent vetting.
  if (issued > at) return false;
  return (at - issued) <= ttlMs(env);
}

module.exports = {issue, isVetted, tokenPath, DEFAULT_TTL_SECONDS};
