'use strict';
// Vetting tokens - proof that THIS live operation was seen by a permission gate.
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
// requires positive proof that a permission gate saw this exact operation:
//
//   A live mutating or destructive operation requires a vetting token
//   BOUND TO THAT OPERATION. No matching token means refusal.
//
// WHAT "BOUND" MEANS, AND WHY AN UNBOUND TOKEN WAS NOT ENOUGH
//
// The first version of this module stored only a timestamp, one token per
// session. That proved "some recognised stripe-x call happened in the last
// 300 seconds", which ordinary read traffic keeps true almost continuously.
// It did not prove that this call was vetted, so an obfuscated invocation
// could ride a token minted by an unrelated routine read.
//
// A token is now filed under canonicalKey(), a string that the guard and the
// engine each compute INDEPENDENTLY - the guard from the command text it
// parsed, the engine from its own argv. Consequences:
//
//   - a token for `customers list` cannot authorise `refunds create --live`,
//     because the two produce different keys;
//   - an arming token cannot authorise an execution, because `arm` is part
//     of the key;
//   - a runtime-assembled invocation the guard never parsed produces no key
//     at all on the guard side, so no token exists for the engine to find.
//
// Where the two sides disagree about a key, the engine refuses. Divergence
// therefore costs a false refusal, never a false authorisation.
//
// Tokens come from exactly two places:
//   1. The PreToolUse guard, whenever it parses a stripe-x invocation that
//      the engine will gate, and does not deny it.
//   2. `stripe-x vet <resource> <action> --live`, which requires a TTY and
//      names the single operation it authorises. Claude Code's Bash tool has
//      no controlling terminal, so an agent cannot mint a token this way,
//      while a human at a terminal can. Treat the TTY requirement as a
//      presence heuristic rather than proof of a human: `script`, `expect`
//      and Python's `pty` all defeat it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {camelizePath} = require('./dispatch');

// Mirrors src/arming.js: generated once per process so a caller cannot pin
// CLAUDE_SESSION_ID to a fixed sentinel and share vetting state across
// unrelated invocations. The safe direction is under-vetting.
const EPHEMERAL_SID = 'ephemeral-' + crypto.randomUUID();

const DEFAULT_TTL_SECONDS = 300;

// Bumped if the key's shape ever changes, so tokens minted by an older build
// can never satisfy a newer one that means something different by the same
// fields.
const KEY_VERSION = 'v1';

function safeSid(env) {
  const raw = env.CLAUDE_SESSION_ID;
  if (!raw) return EPHEMERAL_SID;
  const cleaned = String(raw).replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : EPHEMERAL_SID;
}

// The one definition of "which operation is this", imported by both the guard
// and the engine so the two cannot drift into separate opinions.
//
// Fields are taken as WRITTEN on the command line, never as resolved against
// the registry, because the guard cannot load the registry and the engine
// must be able to agree with it. `account` is the literal --account value, so
// an omitted --account is the empty string on both sides rather than one side
// substituting the default account name. `accountsFile` is included so a
// token minted against one registry cannot authorise the same operation
// against a substituted one.
//
// `resource` is camelized so that spellings which reach the same Stripe
// operation (payment_intents and paymentIntents) share one key. That is
// deliberate: they are the same operation, so binding them together is
// correct rather than a gap.
// The target is part of the key wherever the target is a bare id, so a token
// approved for `customers del --id cus_1` cannot delete cus_999 while it is
// still warm.
//
// KNOWN RESIDUAL, stated rather than glossed: --data is NOT in the key.
// Reconstructing the exact --data text from the engine's parsed object is
// lossy (bracket notation, ordering), and a key both sides cannot compute
// identically would fail closed on legitimate calls instead of binding
// anything. So for an operation whose target lives in --data rather than in
// --id (refunds create --data charge=ch_1 being the important one), a warm
// token still authorises the same operation against a different target
// within the TTL. Narrowing that means canonicalising --data on both sides.
function normalizeIds(value) {
  const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  return list.map((x) => String(x).trim()).filter(Boolean).sort().join(',');
}

function canonicalKey(op) {
  const o = op || {};
  return JSON.stringify([
    KEY_VERSION,
    String(o.account || ''),
    String(o.accountsFile || ''),
    camelizePath(String(o.resource || '')),
    String(o.action || ''),
    o.live ? 'live' : 'test',
    o.arm ? 'arm' : 'exec',
    String(o.id || ''),
    normalizeIds(o.bulkIds)
  ]);
}

// The digest is a filename index only, never the security property: isVetted
// re-checks the full key stored inside the file, so a digest collision or a
// crafted filename cannot authorise an operation the token does not name.
function keyDigest(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function tokenPath(env, key) {
  const dir = path.join(env.CLAUDE_PLUGIN_DATA || '.', 'stripe-x', 'vetting');
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('vetting: a token path requires a canonical operation key');
  }
  return {dir: dir, file: path.join(dir, safeSid(env) + '.' + keyDigest(key) + '.json')};
}

function ttlSeconds(env) {
  const parsed = parseInt(env.CLAUDE_PLUGIN_OPTION_VET_TTL || String(DEFAULT_TTL_SECONDS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

function ttlMs(env) {
  return ttlSeconds(env) * 1000;
}

// `now` is injectable so tests can exercise expiry without sleeping.
function issue(env, key, now) {
  const t = tokenPath(env, key);
  fs.mkdirSync(t.dir, {recursive: true});
  const stamp = typeof now === 'number' ? now : Date.now();
  const tmp = t.file + '.' + process.pid + '.' + stamp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({issued: stamp, key: key}));
  fs.renameSync(tmp, t.file);
  return stamp;
}

function isVetted(env, key, now) {
  // A caller with no key has not identified an operation, so it cannot have
  // been vetted for one. Fail closed rather than throwing into the money path.
  if (typeof key !== 'string' || key.length === 0) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(tokenPath(env, key).file, 'utf8'));
  } catch (e) {
    return false;
  }
  // The stored key is authoritative. The filename digest only found the file.
  if (parsed.key !== key) return false;
  const issued = parsed.issued;
  if (typeof issued !== 'number' || !Number.isFinite(issued)) return false;
  const at = typeof now === 'number' ? now : Date.now();
  // A token stamped in the future is treated as invalid rather than valid
  // forever, so a clock skew or a crafted file cannot mint permanent vetting.
  if (issued > at) return false;
  return (at - issued) <= ttlMs(env);
}

module.exports = {issue, isVetted, tokenPath, canonicalKey, ttlSeconds, DEFAULT_TTL_SECONDS, KEY_VERSION};
