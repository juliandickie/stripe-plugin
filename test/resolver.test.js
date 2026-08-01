const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveAccount, sourceSecret, expandAccounts, isFanOut} = require('../src/resolver');

const reg = {
  default_account: 'idd',
  accounts: {
    // Live keys must be op:// (never env:) - see "an env: live key is
    // refused at load" in test/registry.test.js and the defence-in-depth
    // test below, which cover the shape this fixture must not use.
    idd: {type: 'standalone', test_secret_key: 'env:IDD_TEST', live_secret_key: 'op://V/IDD/live'},
    promktg: {type: 'standalone', test_secret_key: 'env:PM_TEST', live_secret_key: 'op://V/PM/live'},
    acme: {type: 'connect', platform: 'promktg', connected_account: 'acct_ACME'}
  }
};

test('sourceSecret resolves env: and rejects a literal', () => {
  assert.equal(sourceSecret('env:FOO', {FOO: 'sk_live_y'}), 'sk_live_y');
  assert.throws(() => sourceSecret('env:MISSING', {}), /MISSING/);
  assert.throws(() => sourceSecret('sk_test_x', {}), /Unsupported secret reference/);
});

test('op_account for a connect account comes from its platform record', () => {
  let seen = null;
  const runner = (argv) => { seen = argv; return {status: 0, stdout: 'sk_live_plat', stderr: ''}; };
  const r = {
    default_account: 'plat',
    accounts: {
      plat: {type: 'standalone', test_secret_key: 'env:T',
             live_secret_key: 'op://V/Plat/live', op_account: 'plat.1password.com'},
      conn: {type: 'connect', platform: 'plat', connected_account: 'acct_C'}
    }
  };
  const d = resolveAccount(r, 'conn', {live: true, env: {}, opRunner: runner});
  assert.equal(d.apiKey, 'sk_live_plat');
  assert.equal(d.stripeAccount, 'acct_C');
  assert.deepEqual(seen, ['read', 'op://V/Plat/live', '--account', 'plat.1password.com']);
});

test('standalone test mode uses test key, no stripeAccount', () => {
  const d = resolveAccount(reg, 'idd', {live: false, env: {IDD_TEST: 'sk_test_idd'}});
  assert.equal(d.apiKey, 'sk_test_idd');
  assert.equal(d.stripeAccount, undefined);
  assert.equal(d.mode, 'test');
});

test('standalone live mode reads op-sourced key', () => {
  const runner = () => ({status: 0, stdout: 'sk_live_idd', stderr: ''});
  const d = resolveAccount(reg, 'idd', {live: true, env: {}, opRunner: runner});
  assert.equal(d.apiKey, 'sk_live_idd');
  assert.equal(d.mode, 'live');
});

test('connect resolves platform key plus stripeAccount', () => {
  const d = resolveAccount(reg, 'acme', {live: false, env: {PM_TEST: 'sk_test_pm'}});
  assert.equal(d.apiKey, 'sk_test_pm');
  assert.equal(d.stripeAccount, 'acct_ACME');
});

test('unknown account throws with available names', () => {
  assert.throws(() => resolveAccount(reg, 'nope', {live: false, env: {}}), /idd, promktg, acme/);
});

test('resolveAccount falls back to default_account when name is absent', () => {
  const d = resolveAccount(reg, null, {live: false, env: {IDD_TEST: 'sk_test_idd'}});
  assert.equal(d.name, 'idd');
  assert.equal(d.apiKey, 'sk_test_idd');
});

test('connect live mode uses platform live key (op-sourced) plus stripeAccount', () => {
  const liveReg = {
    default_account: 'idd',
    accounts: {
      promktg: {type: 'standalone', test_secret_key: 'env:PM_TEST', live_secret_key: 'op://V/PM/live-actual'},
      acme: {type: 'connect', platform: 'promktg', connected_account: 'acct_ACME'}
    }
  };
  const runner = () => ({status: 0, stdout: 'sk_live_pm_actual', stderr: ''});
  const d = resolveAccount(liveReg, 'acme', {live: true, env: {}, opRunner: runner});
  assert.equal(d.apiKey, 'sk_live_pm_actual');
  assert.equal(d.stripeAccount, 'acct_ACME');
  assert.equal(d.mode, 'live');
});

test('resolveAccount refuses an env: live key even when the caller bypasses loadRegistry (defence in depth)', () => {
  // loadRegistry (src/registry.js) already refuses this shape at load time -
  // see "an env: live key is refused at load" in test/registry.test.js. This
  // proves the same rule holds inside resolveAccount itself, for a registry
  // object assembled by hand (or by any future entry point) that never went
  // through loadRegistry at all.
  const bypassReg = {
    default_account: 'sneaky',
    accounts: {
      sneaky: {type: 'standalone', test_secret_key: 'env:T', live_secret_key: 'env:SNEAKY_LIVE'}
    }
  };
  assert.throws(() => resolveAccount(bypassReg, 'sneaky',
    {live: true, env: {SNEAKY_LIVE: 'sk_live_should_never_resolve'}}),
    /account "sneaky": live_secret_key must be a 1Password reference/);
});

test('resolveAccount validates a Connect account live key against the platform name, not the connect name', () => {
  const bypassReg = {
    default_account: 'conn',
    accounts: {
      plat: {type: 'standalone', test_secret_key: 'env:T', live_secret_key: 'env:PLAT_LIVE'},
      conn: {type: 'connect', platform: 'plat', connected_account: 'acct_X'}
    }
  };
  assert.throws(() => resolveAccount(bypassReg, 'conn',
    {live: true, env: {PLAT_LIVE: 'sk_live_should_never_resolve'}}),
    /account "plat": live_secret_key must be a 1Password reference/);
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
