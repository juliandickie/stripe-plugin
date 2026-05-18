const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {resolveRegistryPath, loadRegistry} = require('../src/registry');

function tmpFile(obj) {
  const p = path.join(os.tmpdir(), 'reg-' + Math.random().toString(16).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('flag beats env beats userConfig beats default', () => {
  const env = {STRIPE_X_ACCOUNTS_FILE: '/from/env.json', CLAUDE_PLUGIN_OPTION_ACCOUNTS_FILE: '/from/uc.json', CLAUDE_PLUGIN_DATA: '/data'};
  assert.equal(resolveRegistryPath({flag: '/from/flag.json'}, env), '/from/flag.json');
  assert.equal(resolveRegistryPath({}, env), '/from/env.json');
  assert.equal(resolveRegistryPath({}, {CLAUDE_PLUGIN_OPTION_ACCOUNTS_FILE: '/from/uc.json', CLAUDE_PLUGIN_DATA: '/data'}), '/from/uc.json');
  assert.equal(resolveRegistryPath({}, {CLAUDE_PLUGIN_DATA: '/data'}), '/data/stripe-x/accounts.json');
});

test('loadRegistry parses and validates shape', () => {
  const p = tmpFile({default_account: 'a', accounts: {a: {type: 'standalone', test_secret_key: 'sk_test_x'}}});
  const r = loadRegistry(p);
  assert.equal(r.default_account, 'a');
  assert.equal(r.accounts.a.type, 'standalone');
});

test('loadRegistry rejects missing accounts object', () => {
  const p = tmpFile({default_account: 'a'});
  assert.throws(() => loadRegistry(p), /accounts/);
});
