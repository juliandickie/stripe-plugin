const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mapStripeError, aggregate} = require('../src/errors');

test('mapStripeError extracts the documented fields', () => {
  const raw = Object.assign(new Error('Your card was declined.'), {
    type: 'StripeCardError', rawType: 'card_error', code: 'card_declined',
    doc_url: 'https://stripe.com/docs/error-codes/card-declined',
    param: 'number', requestId: 'req_123', statusCode: 402
  });
  const m = mapStripeError(raw);
  assert.equal(m.type, 'StripeCardError');
  assert.equal(m.code, 'card_declined');
  assert.equal(m.request_id, 'req_123');
  assert.equal(m.status_code, 402);
  assert.equal(m.doc_url, 'https://stripe.com/docs/error-codes/card-declined');
});

test('mapStripeError handles a non-Stripe error', () => {
  const m = mapStripeError(new Error('boom'));
  assert.equal(m.type, 'Error');
  assert.equal(m.message, 'boom');
});

test('aggregate is fail-loud: any failure means ok=false with partial counts', () => {
  const a = aggregate([
    {account: 'idd', ok: true, data: {}},
    {account: 'acme', ok: false, error: {type: 'StripeRateLimitError', message: 'slow down'}}
  ]);
  assert.equal(a.ok, false);
  assert.equal(a.succeeded, 1);
  assert.equal(a.failed, 1);
  assert.match(a.summary, /1 of 2 succeeded/);
  assert.match(a.summary, /acme failed/);
});

test('aggregate ok=true only when all succeed', () => {
  const a = aggregate([{account: 'idd', ok: true, data: {}}]);
  assert.equal(a.ok, true);
  assert.equal(a.summary, '1 of 1 succeeded');
});
