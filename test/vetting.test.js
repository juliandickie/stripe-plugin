const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {issue, isVetted, DEFAULT_TTL_SECONDS} = require('../src/vetting');

function dataDir() {
  const d = path.join(os.tmpdir(), 'vet-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(d, {recursive: true});
  return d;
}

const TTL_MS = DEFAULT_TTL_SECONDS * 1000;

test('not vetted by default', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  assert.equal(isVetted(env), false);
});

test('issue then isVetted true for the same session', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, now);
  assert.equal(isVetted(env, now), true);
  assert.equal(isVetted(env, now + 1000), true);
});

test('a token older than the TTL is not vetted', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, now);
  assert.equal(isVetted(env, now + TTL_MS + 1), false);
});

test('a token exactly at the TTL boundary is still vetted', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, now);
  assert.equal(isVetted(env, now + TTL_MS), true);
});

test('a token stamped in the future is refused rather than valid forever', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  const now = 1_000_000;
  issue(env, now + 5000); // clock skew / crafted file: issued is "later" than now
  assert.equal(isVetted(env, now), false);
});

test('crafted session id cannot escape the vetting directory', () => {
  const base = dataDir();
  const vettingRoot = path.join(base, 'stripe-x', 'vetting');
  const env = {CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: '../../../../tmp/evil'};
  const now = 1_000_000;
  issue(env, now);
  // The token file must remain inside the vetting root, not at a traversed path.
  const files = fs.readdirSync(vettingRoot);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes('/') && !files[0].includes('..'));
  assert.equal(isVetted(env, now), true);
});

test('absent session id does not collide with a caller who pins the literal string "no-session"', () => {
  const base = dataDir();
  const now = 1_000_000;
  const spoof = {CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: 'no-session'};
  issue(spoof, now);
  const absent = {CLAUDE_PLUGIN_DATA: base};
  assert.equal(isVetted(absent, now), false);
});

test('CLAUDE_PLUGIN_OPTION_VET_TTL is honoured', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1', CLAUDE_PLUGIN_OPTION_VET_TTL: '10'};
  const now = 1_000_000;
  issue(env, now);
  assert.equal(isVetted(env, now + 10_000), true);
  assert.equal(isVetted(env, now + 10_001), false);
});

test('a non-numeric CLAUDE_PLUGIN_OPTION_VET_TTL falls back to the default', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1', CLAUDE_PLUGIN_OPTION_VET_TTL: 'notanumber'};
  const now = 1_000_000;
  issue(env, now);
  assert.equal(isVetted(env, now + TTL_MS), true);
  assert.equal(isVetted(env, now + TTL_MS + 1), false);
});

test('issue writes atomically (no leftover .tmp files)', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's-atomic'};
  issue(env, 1_000_000);
  issue(env, 1_000_001);
  const dir = path.join(env.CLAUDE_PLUGIN_DATA, 'stripe-x', 'vetting');
  const leftover = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftover, []);
});
