const {test} = require('node:test');
const assert = require('node:assert/strict');
const {classify, DESTRUCTIVE} = require('../src/classify');

test('reads are read class', () => {
  assert.equal(classify('customers', 'list'), 'read');
  assert.equal(classify('customers', 'retrieve'), 'read');
  assert.equal(classify('charges', 'search'), 'read');
  assert.equal(classify('balance', 'retrieve'), 'read');
});

test('plain create and update are mutating', () => {
  assert.equal(classify('customers', 'create'), 'mutating');
  assert.equal(classify('products', 'update'), 'mutating');
});

test('del and money-movers are destructive', () => {
  assert.equal(classify('customers', 'del'), 'destructive');
  assert.equal(classify('refunds', 'create'), 'destructive');
  assert.equal(classify('payouts', 'create'), 'destructive');
  assert.equal(classify('payouts', 'cancel'), 'destructive');
  assert.equal(classify('transfers', 'create'), 'destructive');
  assert.equal(classify('subscriptions', 'cancel'), 'destructive');
  assert.equal(classify('paymentIntents', 'cancel'), 'destructive');
  assert.equal(classify('disputes', 'close'), 'destructive');
  assert.equal(classify('sources', 'detach'), 'destructive');
  assert.equal(classify('accounts', 'del'), 'destructive');
});

test('unknown action defaults to mutating (safe minimum)', () => {
  assert.equal(classify('widgets', 'frobnicate'), 'mutating');
});

test('DESTRUCTIVE override list is frozen and contains money movers', () => {
  assert.ok(Object.isFrozen(DESTRUCTIVE));
  assert.ok(DESTRUCTIVE.has('refunds.create'));
  assert.ok(DESTRUCTIVE.has('transfers.createReversal'));
});

test('READ_ACTIONS is frozen', () => {
  const {READ_ACTIONS} = require('../src/classify');
  assert.ok(Object.isFrozen(READ_ACTIONS));
});
