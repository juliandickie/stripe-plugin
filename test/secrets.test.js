const {test} = require('node:test');
const assert = require('node:assert/strict');
const {assertRefAcceptable, resolveSecretRef, _resetCache} = require('../src/secrets');

const ctxTest = {field: 'test_secret_key', account: 'idd', live: false};
const ctxLive = {field: 'live_secret_key', account: 'idd', live: true};

test('op:// is acceptable for both test and live', () => {
  assertRefAcceptable('op://Private/Stripe/test', ctxTest);
  assertRefAcceptable('op://Private/Stripe/live', ctxLive);
});

test('env: is acceptable for test but refused for live', () => {
  assertRefAcceptable('env:FOO', ctxTest);
  assert.throws(() => assertRefAcceptable('env:FOO', ctxLive), /1Password reference/);
});

test('a literal secret is refused with the account and field named', () => {
  assert.throws(() => assertRefAcceptable('sk_test_abc', ctxTest), /idd/);
  assert.throws(() => assertRefAcceptable('sk_test_abc', ctxTest), /test_secret_key/);
  assert.throws(() => assertRefAcceptable('sk_test_abc', ctxTest), /Plaintext/);
});

test('an empty or non-string ref is refused', () => {
  assert.throws(() => assertRefAcceptable('', ctxTest), /missing or empty/);
  assert.throws(() => assertRefAcceptable(undefined, ctxTest), /missing or empty/);
});

test('a keychain-looking ref is refused like any other unknown prefix', () => {
  assert.throws(() => assertRefAcceptable('keychain:StripeIDD', ctxTest), /op:\/\/ or env:/);
});

test('env: resolves from the supplied env', () => {
  assert.equal(resolveSecretRef('env:FOO', {env: {FOO: 'sk_test_y'}}), 'sk_test_y');
});

test('env: raises when unset or empty', () => {
  assert.throws(() => resolveSecretRef('env:MISSING', {env: {}}), /MISSING/);
  assert.throws(() => resolveSecretRef('env:EMPTY', {env: {EMPTY: ''}}), /EMPTY/);
});

test('op:// calls op read and returns the trimmed secret', () => {
  _resetCache();
  const calls = [];
  const runner = (argv, opts) => {
    calls.push({argv, opts});
    return {status: 0, stdout: 'sk_live_fromop\n', stderr: ''};
  };
  const got = resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner});
  assert.equal(got, 'sk_live_fromop');
  assert.deepEqual(calls[0].argv, ['read', 'op://V/I/f']);
});

test('op_account is passed through as --account', () => {
  _resetCache();
  let seen = null;
  const runner = (argv) => { seen = argv; return {status: 0, stdout: 'k', stderr: ''}; };
  resolveSecretRef('op://V/I/f', {env: {}, opAccount: 'promarketing.1password.com', opRunner: runner});
  assert.deepEqual(seen, ['read', 'op://V/I/f', '--account', 'promarketing.1password.com']);
});

test('op:// results are cached per process, so a fan-out reads once', () => {
  _resetCache();
  let n = 0;
  const runner = () => { n++; return {status: 0, stdout: 'k', stderr: ''}; };
  resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner});
  resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner});
  assert.equal(n, 1);
});

test('the cache is keyed by account, so two accounts do not collide', () => {
  _resetCache();
  const runner = (argv) => ({status: 0, stdout: argv.includes('a.com') ? 'ka' : 'kb', stderr: ''});
  const a = resolveSecretRef('op://V/I/f', {env: {}, opAccount: 'a.com', opRunner: runner});
  const b = resolveSecretRef('op://V/I/f', {env: {}, opAccount: 'b.com', opRunner: runner});
  assert.equal(a, 'ka');
  assert.equal(b, 'kb');
});

test('a missing op binary raises an install hint', () => {
  _resetCache();
  const err = new Error('spawn op ENOENT'); err.code = 'ENOENT';
  const runner = () => ({status: null, stdout: '', stderr: '', error: err});
  assert.throws(() => resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner}), /not installed/);
});

test('an op timeout raises an unlock hint', () => {
  _resetCache();
  const err = new Error('timeout'); err.code = 'ETIMEDOUT';
  const runner = () => ({status: null, stdout: '', stderr: '', error: err});
  assert.throws(() => resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner}), /unlock/i);
});

test('a multiple-accounts error hints at op_account', () => {
  _resetCache();
  const runner = () => ({status: 1, stdout: '', stderr: 'error: multiple accounts found'});
  assert.throws(() => resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner}), /op_account/);
});

test('a generic op failure surfaces stderr and never falls back', () => {
  _resetCache();
  const runner = () => ({status: 1, stdout: '', stderr: 'item not found'});
  assert.throws(() => resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner}), /item not found/);
});

test('an unknown prefix raises rather than being treated as a literal', () => {
  assert.throws(() => resolveSecretRef('sk_live_raw', {env: {}}), /Unsupported secret reference/);
});

test('the unsupported-reference error never echoes the value', () => {
  // Reaching that branch usually means a raw key was pasted into the
  // registry, so the rejected value is itself the secret.
  try {
    resolveSecretRef('sk_live_LEAKME', {env: {}});
    assert.fail('expected a throw');
  } catch (e) {
    assert.doesNotMatch(e.message, /sk_live_LEAKME/);
  }
});

test('op returning an empty value raises', () => {
  _resetCache();
  const runner = () => ({status: 0, stdout: '\n', stderr: ''});
  assert.throws(() => resolveSecretRef('op://V/I/f', {env: {}, opRunner: runner}), /empty value/);
});

test('a non-numeric op timeout falls back to the default rather than NaN', () => {
  _resetCache();
  let seen = null;
  const runner = (argv, opts) => { seen = opts; return {status: 0, stdout: 'k', stderr: ''}; };
  resolveSecretRef('op://V/I/f',
    {env: {CLAUDE_PLUGIN_OPTION_OP_TIMEOUT: 'banana'}, opRunner: runner});
  assert.equal(seen.timeout, 60000);
});
