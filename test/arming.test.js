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
