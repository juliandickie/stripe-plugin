const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildCliArgs, blocksTriggerInLive, resolveCliBinary} = require('../src/cli_bridge');

test('buildCliArgs adds --api-key and stripe-account for connect', () => {
  const a = buildCliArgs(['listen'], {apiKey: 'sk_test_x', stripeAccount: 'acct_1'});
  assert.deepEqual(a, ['listen', '--api-key', 'sk_test_x', '--stripe-account', 'acct_1']);
});

test('buildCliArgs omits stripe-account for standalone', () => {
  const a = buildCliArgs(['logs', 'tail'], {apiKey: 'sk_live_x'});
  assert.deepEqual(a, ['logs', 'tail', '--api-key', 'sk_live_x']);
});

test('trigger is blocked in live mode only', () => {
  assert.equal(blocksTriggerInLive('trigger', 'live'), true);
  assert.equal(blocksTriggerInLive('trigger', 'test'), false);
  assert.equal(blocksTriggerInLive('listen', 'live'), false);
});

test('resolveCliBinary builds the pinned data-dir path', () => {
  const p = resolveCliBinary({CLAUDE_PLUGIN_DATA: '/data'}, '1.31.0');
  assert.equal(p, '/data/stripe-cli/1.31.0/stripe');
});
