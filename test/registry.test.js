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
  const p = tmpFile({default_account: 'a', accounts: {a: {type: 'standalone', test_secret_key: 'env:T'}}});
  const r = loadRegistry(p);
  assert.equal(r.default_account, 'a');
  assert.equal(r.accounts.a.type, 'standalone');
});

test('loadRegistry rejects missing accounts object', () => {
  const p = tmpFile({default_account: 'a'});
  assert.throws(() => loadRegistry(p), /accounts/);
});

test('loadRegistry throws a not-found error on a missing file', () => {
  assert.throws(() => loadRegistry(path.join(os.tmpdir(), 'definitely-missing-' + Math.random().toString(16).slice(2) + '.json')), /not found/);
});

test('loadRegistry rejects accounts that is an array', () => {
  const p = tmpFile({default_account: 'a', accounts: []});
  assert.throws(() => loadRegistry(p), /accounts/);
});

test('a plaintext secret in the registry is refused at load', () => {
  const p = tmpFile({default_account: 'a',
    accounts: {a: {type: 'standalone', test_secret_key: 'sk_test_x'}}});
  assert.throws(() => loadRegistry(p), /Plaintext/);
});

test('an env: live key is refused at load', () => {
  const p = tmpFile({default_account: 'a',
    accounts: {a: {type: 'standalone', test_secret_key: 'env:T', live_secret_key: 'env:L'}}});
  assert.throws(() => loadRegistry(p), /1Password reference/);
});

test('a valid reference-based registry loads', () => {
  const p = tmpFile({default_account: 'a',
    accounts: {a: {type: 'standalone', test_secret_key: 'env:T',
                   live_secret_key: 'op://V/I/live'}}});
  const reg = loadRegistry(p);
  assert.equal(reg.default_account, 'a');
});

test('a connect account is not required to carry its own keys', () => {
  const p = tmpFile({default_account: 'p', accounts: {
    p: {type: 'standalone', test_secret_key: 'env:T', live_secret_key: 'op://V/I/live'},
    c: {type: 'connect', platform: 'p', connected_account: 'acct_1'}
  }});
  const reg = loadRegistry(p);
  assert.equal(reg.accounts.c.type, 'connect');
});

test('loadRegistry rejects a non-object account entry', () => {
  const p = tmpFile({default_account: 'a', accounts: {a: null}});
  assert.throws(() => loadRegistry(p), /must be an object/);
});
