const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {isArmed, arm} = require('../src/arming');

function dataDir() {
  const d = path.join(os.tmpdir(), 'arm-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(d, {recursive: true});
  return d;
}

test('not armed by default', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  assert.equal(isArmed('idd', env), false);
});

test('arm then isArmed true for same session and account only', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's1'};
  arm('idd', env);
  assert.equal(isArmed('idd', env), true);
  assert.equal(isArmed('promktg', env), false);
  const env2 = Object.assign({}, env, {CLAUDE_SESSION_ID: 's2'});
  assert.equal(isArmed('idd', env2), false);
});

test('crafted session id cannot escape the arming directory', () => {
  const base = dataDir();
  const armingRoot = path.join(base, 'stripe-x', 'arming');
  const env = {CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: '../../../../tmp/evil'};
  arm('idd', env);
  // The token file must remain inside the arming root, not at a traversed path.
  const files = fs.readdirSync(armingRoot);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes('/') && !files[0].includes('..'));
  assert.equal(isArmed('idd', env), true);
});

test('absent session id does not collide with a spoofed no-session caller', () => {
  const base = dataDir();
  const spoof = {CLAUDE_PLUGIN_DATA: base, CLAUDE_SESSION_ID: 'no-session'};
  arm('idd', spoof);
  const absent = {CLAUDE_PLUGIN_DATA: base};
  assert.equal(isArmed('idd', absent), false);
});

test('arm writes atomically (no leftover .tmp, file valid after arm)', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's-atomic'};
  arm('a', env);
  arm('b', env);
  assert.equal(isArmed('a', env), true);
  assert.equal(isArmed('b', env), true);
  const dir = require('node:path').join(env.CLAUDE_PLUGIN_DATA, 'stripe-x', 'arming');
  const leftover = require('node:fs').readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftover, []);
});
