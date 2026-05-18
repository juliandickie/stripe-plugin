const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {preflight} = require('../src/dispatch');

test('api-map asset exists and contains core resources', () => {
  const map = JSON.parse(fs.readFileSync(__dirname + '/../assets/stripe-api-map.json', 'utf8'));
  assert.ok(map['customers.create']);
  assert.ok(map['refunds.create']);
  assert.equal(map['customers.create'].httpMethod, 'POST');
  assert.equal(map['customers.list'].httpMethod, 'GET');
  assert.ok(map['issuing.cards.list'], 'issuing.cards.list missing - namespace tier not walked');
  assert.ok(map['treasury.financialAccounts.retrieve'], 'treasury.financialAccounts.retrieve missing');
  assert.ok(map['checkout.sessions.create'], 'checkout.sessions.create missing');
});

test('preflight passes for a known operation', () => {
  const map = JSON.parse(fs.readFileSync(__dirname + '/../assets/stripe-api-map.json', 'utf8'));
  assert.equal(preflight(map, 'customers', 'list').ok, true);
});

test('preflight fails for an unknown operation with suggestion', () => {
  const map = JSON.parse(fs.readFileSync(__dirname + '/../assets/stripe-api-map.json', 'utf8'));
  const r = preflight(map, 'customer', 'lst');
  assert.equal(r.ok, false);
  assert.match(r.message, /Unknown/);
});
