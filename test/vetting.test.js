const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {issue, isVetted, tokenPath, canonicalKey, DEFAULT_TTL_SECONDS} = require('../src/vetting');

function dataDir() {
  const d = path.join(os.tmpdir(), 'vet-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(d, {recursive: true});
  return d;
}

const TTL_MS = DEFAULT_TTL_SECONDS * 1000;

// The operation most of these tests are about.
const REFUND = canonicalKey({account: 'idd', resource: 'refunds', action: 'create', live: true});

test('not vetted by default', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  assert.equal(isVetted(env, REFUND), false);
});

test('issue then isVetted true for the same session and the same operation', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  assert.equal(isVetted(env, REFUND, now), true);
  assert.equal(isVetted(env, REFUND, now + 1000), true);
});

// --- Binding: the property the unbound token did not have ---
//
// The first version stored one timestamp per session, so a token proved only
// that SOME recognised stripe-x call had happened recently. Ordinary reads
// kept that true almost continuously, which meant an obfuscated live call
// could ride a token minted by an unrelated read. These tests pin the
// replacement guarantee: a token names one operation and vets nothing else.

test('a token for one operation does not vet a different operation', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const list = canonicalKey({account: 'idd', resource: 'customers', action: 'list', live: true});
  issue(env, list, now);
  assert.equal(isVetted(env, list, now), true);
  assert.equal(isVetted(env, REFUND, now), false, 'a customers-list token must not authorise a refund');
});

test('an arming token does not authorise the execution it arms for', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const armKey = canonicalKey({account: 'idd', resource: 'refunds', action: 'create', live: true, arm: true});
  issue(env, armKey, now);
  assert.equal(isVetted(env, armKey, now), true);
  assert.equal(isVetted(env, REFUND, now), false, 'arming and executing are separate authorisations');
});

test('a token does not cross accounts', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  const other = canonicalKey({account: 'promktg', resource: 'refunds', action: 'create', live: true});
  assert.equal(isVetted(env, other, now), false);
});

test('a token does not cross test and live mode', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const testMode = canonicalKey({account: 'idd', resource: 'refunds', action: 'create', live: false});
  issue(env, testMode, now);
  assert.equal(isVetted(env, REFUND, now), false);
});

test('a token minted against one registry does not authorise a substituted one', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const real = canonicalKey({account: 'idd', accountsFile: '/real/accounts.json',
    resource: 'refunds', action: 'create', live: true});
  const swapped = canonicalKey({account: 'idd', accountsFile: '/tmp/attacker.json',
    resource: 'refunds', action: 'create', live: true});
  issue(env, real, now);
  assert.equal(isVetted(env, swapped, now), false);
});

test('an omitted account is not the same key as a named one', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const noAccount = canonicalKey({resource: 'refunds', action: 'create', live: true});
  issue(env, noAccount, now);
  assert.equal(isVetted(env, REFUND, now), false);
  assert.equal(isVetted(env, noAccount, now), true);
});

test('spellings that reach the same Stripe operation share one key', () => {
  // Deliberate: payment_intents and paymentIntents are the same operation, so
  // binding them together is correct rather than a gap. It also means the
  // guard and the engine cannot disagree over snake case.
  const snake = canonicalKey({account: 'idd', resource: 'payment_intents', action: 'cancel', live: true});
  const camel = canonicalKey({account: 'idd', resource: 'paymentIntents', action: 'cancel', live: true});
  assert.equal(snake, camel);
});

test('a nested resource path is part of the key', () => {
  const a = canonicalKey({account: 'idd', resource: 'test_helpers.customers', action: 'fund', live: true});
  const b = canonicalKey({account: 'idd', resource: 'customers', action: 'fund', live: true});
  assert.notEqual(a, b);
});

test('the stored key is authoritative, not the filename digest', () => {
  // A file placed at the path for one operation but naming another must not
  // vet either: the digest only locates the file, isVetted re-checks the key.
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const list = canonicalKey({account: 'idd', resource: 'customers', action: 'list', live: true});
  const t = tokenPath(env, REFUND);
  fs.mkdirSync(t.dir, {recursive: true});
  fs.writeFileSync(t.file, JSON.stringify({issued: now, key: list}));
  assert.equal(isVetted(env, REFUND, now), false, 'the file names a different operation');
});

test('a token file with no key field is refused', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  const t = tokenPath(env, REFUND);
  fs.mkdirSync(t.dir, {recursive: true});
  // The shape the unbound implementation wrote. It must not satisfy the
  // bound one, so an old token on disk cannot authorise anything.
  fs.writeFileSync(t.file, JSON.stringify({issued: now}));
  assert.equal(isVetted(env, REFUND, now), false);
});

test('an absent or empty key is never vetted', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  assert.equal(isVetted(env, undefined, now), false);
  assert.equal(isVetted(env, '', now), false);
  assert.equal(isVetted(env, null, now), false);
});

test('issuing without a key throws rather than writing an unbound token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  assert.throws(() => issue(env, undefined, 1_000_000), /canonical operation key/);
  assert.throws(() => issue(env, '', 1_000_000), /canonical operation key/);
});

// --- Expiry, session scoping and storage hygiene ---

test('a token older than the TTL is not vetted', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  assert.equal(isVetted(env, REFUND, now + TTL_MS + 1), false);
});

test('a token exactly at the TTL boundary is still vetted', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  assert.equal(isVetted(env, REFUND, now + TTL_MS), true);
});

test('a token stamped in the future is refused rather than valid forever', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, REFUND, now + 5000); // clock skew / crafted file: issued is "later" than now
  assert.equal(isVetted(env, REFUND, now), false);
});

test('a token does not cross sessions', () => {
  const base = dataDir();
  const now = 1_000_000;
  issue({CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: 's1'}, REFUND, now);
  assert.equal(isVetted({CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: 's2'}, REFUND, now), false);
});

test('crafted session id cannot escape the vetting directory', () => {
  const base = dataDir();
  const vettingRoot = path.join(base, 'stripe-x', 'vetting');
  const env = {CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: '../../../../tmp/evil'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  // The token file must remain inside the vetting root, not at a traversed path.
  const files = fs.readdirSync(vettingRoot);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes('/') && !files[0].includes('..'));
  assert.equal(isVetted(env, REFUND, now), true);
});

test('absent session id does not collide with a caller who pins the literal string "no-session"', () => {
  const base = dataDir();
  const now = 1_000_000;
  const spoof = {CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: 'no-session'};
  issue(spoof, REFUND, now);
  const absent = {CLAUDE_PLUGIN_DATA: base};
  assert.equal(isVetted(absent, REFUND, now), false);
});

test('CLAUDE_PLUGIN_OPTION_VET_TTL is honoured', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1', CLAUDE_PLUGIN_OPTION_VET_TTL: '10'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  assert.equal(isVetted(env, REFUND, now + 10_000), true);
  assert.equal(isVetted(env, REFUND, now + 10_001), false);
});

test('a non-numeric CLAUDE_PLUGIN_OPTION_VET_TTL falls back to the default', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1', CLAUDE_PLUGIN_OPTION_VET_TTL: 'notanumber'};
  const now = 1_000_000;
  issue(env, REFUND, now);
  assert.equal(isVetted(env, REFUND, now + TTL_MS), true);
  assert.equal(isVetted(env, REFUND, now + TTL_MS + 1), false);
});

test('issue writes atomically (no leftover .tmp files)', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's-atomic'};
  issue(env, REFUND, 1_000_000);
  issue(env, REFUND, 1_000_001);
  const dir = path.join(env.CLAUDE_PLUGIN_DATA, 'stripe-x', 'vetting');
  const leftover = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftover, []);
});

test('two operations in one session occupy separate token files', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's-two'};
  const now = 1_000_000;
  const list = canonicalKey({account: 'idd', resource: 'customers', action: 'list', live: true});
  issue(env, REFUND, now);
  issue(env, list, now);
  const dir = path.join(env.CLAUDE_PLUGIN_DATA, 'stripe-x', 'vetting');
  assert.equal(fs.readdirSync(dir).length, 2);
  assert.equal(isVetted(env, REFUND, now), true);
  assert.equal(isVetted(env, list, now), true);
});
