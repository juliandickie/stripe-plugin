const {test} = require('node:test');
const assert = require('node:assert/strict');
const {needsScopeReview, scopeReview} = require('../src/bulk');

test('needsScopeReview true when target count exceeds threshold', () => {
  assert.equal(needsScopeReview(11, 10), true);
  assert.equal(needsScopeReview(10, 10), false);
  assert.equal(needsScopeReview(1, 10), false);
});

test('scopeReview lists every target id', () => {
  const r = scopeReview('subscriptions', 'cancel', ['sub_1', 'sub_2', 'sub_3']);
  assert.equal(r.action, 'subscriptions.cancel');
  assert.equal(r.count, 3);
  assert.deepEqual(r.targets, ['sub_1', 'sub_2', 'sub_3']);
});
