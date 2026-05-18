const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveAccount, sourceSecret, expandAccounts, isFanOut} = require('../src/resolver');

const reg = {
  default_account: 'idd',
  accounts: {
    idd: {type: 'standalone', test_secret_key: 'sk_test_idd', live_secret_key: 'env:IDD_LIVE'},
    promktg: {type: 'standalone', test_secret_key: 'sk_test_pm', live_secret_key: 'sk_live_pm'},
    acme: {type: 'connect', platform: 'promktg', connected_account: 'acct_ACME'}
  }
};

test('sourceSecret resolves literal and env: forms', () => {
  assert.equal(sourceSecret('sk_test_x', {}), 'sk_test_x');
  assert.equal(sourceSecret('env:FOO', {FOO: 'sk_live_y'}), 'sk_live_y');
  assert.throws(() => sourceSecret('env:MISSING', {}), /MISSING/);
});

test('standalone test mode uses test key, no stripeAccount', () => {
  const d = resolveAccount(reg, 'idd', {live: false, env: {}});
  assert.equal(d.apiKey, 'sk_test_idd');
  assert.equal(d.stripeAccount, undefined);
  assert.equal(d.mode, 'test');
});

test('standalone live mode reads env-sourced key', () => {
  const d = resolveAccount(reg, 'idd', {live: true, env: {IDD_LIVE: 'sk_live_idd'}});
  assert.equal(d.apiKey, 'sk_live_idd');
  assert.equal(d.mode, 'live');
});

test('connect resolves platform key plus stripeAccount', () => {
  const d = resolveAccount(reg, 'acme', {live: false, env: {}});
  assert.equal(d.apiKey, 'sk_test_pm');
  assert.equal(d.stripeAccount, 'acct_ACME');
});

test('unknown account throws with available names', () => {
  assert.throws(() => resolveAccount(reg, 'nope', {live: false, env: {}}), /idd, promktg, acme/);
});

test('resolveAccount falls back to default_account when name is absent', () => {
  const d = resolveAccount(reg, null, {live: false, env: {}});
  assert.equal(d.name, 'idd');
  assert.equal(d.apiKey, 'sk_test_idd');
});

test('connect live mode uses platform live key (env-sourced) plus stripeAccount', () => {
  const liveReg = {
    default_account: 'idd',
    accounts: {
      promktg: {type: 'standalone', test_secret_key: 'sk_test_pm', live_secret_key: 'env:PM_LIVE'},
      acme: {type: 'connect', platform: 'promktg', connected_account: 'acct_ACME'}
    }
  };
  const d = resolveAccount(liveReg, 'acme', {live: true, env: {PM_LIVE: 'sk_live_pm_actual'}});
  assert.equal(d.apiKey, 'sk_live_pm_actual');
  assert.equal(d.stripeAccount, 'acct_ACME');
  assert.equal(d.mode, 'live');
});

test('expandAccounts handles single, comma list, and all', () => {
  assert.deepEqual(expandAccounts(reg, 'idd'), ['idd']);
  assert.deepEqual(expandAccounts(reg, 'idd,acme'), ['idd', 'acme']);
  assert.deepEqual(expandAccounts(reg, 'all').sort(), ['acme', 'idd', 'promktg']);
});

test('expandAccounts rejects unknown name in list', () => {
  assert.throws(() => expandAccounts(reg, 'idd,ghost'), /ghost/);
});

test('isFanOut true for more than one account', () => {
  assert.equal(isFanOut(['idd']), false);
  assert.equal(isFanOut(['idd', 'acme']), true);
});

test('expandAccounts throws on empty spec', () => {
  assert.throws(() => expandAccounts(reg, ''), /No account specified/);
  assert.throws(() => expandAccounts(reg, ','), /No account specified/);
});
