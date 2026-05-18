const {test} = require('node:test');
const assert = require('node:assert/strict');
const {camelizePath, resolveMethod, callStripe, genIdempotencyKey} = require('../src/dispatch');

function fakeClient() {
  const calls = [];
  const listReturn = {
    autoPagingToArray: async (o) => { calls.push(['autopage', o.limit]); return [{id: 'c_1'}, {id: 'c_2'}]; }
  };
  return {
    calls: calls,
    customers: {
      create: async (params, opts) => { calls.push(['customers.create', params, opts]); return {id: 'cus_1', params: params, opts: opts}; },
      retrieve: async (id, params, opts) => { calls.push(['customers.retrieve', id, opts]); return {id: id}; },
      list: (params, opts) => { calls.push(['customers.list', params, opts]); return listReturn; }
    },
    issuing: {
      cards: { list: (params, opts) => { calls.push(['issuing.cards.list', params, opts]); return listReturn; } }
    }
  };
}

test('camelizePath converts snake segments', () => {
  assert.equal(camelizePath('treasury.financial_accounts'), 'treasury.financialAccounts');
  assert.equal(camelizePath('issuing.cards'), 'issuing.cards');
  assert.equal(camelizePath('reporting.report_runs'), 'reporting.reportRuns');
});

test('resolveMethod walks the SDK graph and returns segment plus fn', () => {
  const c = fakeClient();
  const r = resolveMethod(c, 'issuing.cards', 'list');
  assert.equal(typeof r.fn, 'function');
  assert.equal(r.resourceSegment, 'cards');
});

test('resolveMethod throws for unknown resource or action', () => {
  const c = fakeClient();
  assert.throws(() => resolveMethod(c, 'nope.things', 'list'), /nope/);
  assert.throws(() => resolveMethod(c, 'customers', 'fly'), /customers\.fly/);
});

test('callStripe shapes args: create takes (params, opts)', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'customers', 'create', {params: {email: 'a@b.co'}, options: {idempotencyKey: 'k1'}});
  assert.equal(out.id, 'cus_1');
  assert.deepEqual(c.calls[0], ['customers.create', {email: 'a@b.co'}, {idempotencyKey: 'k1'}]);
});

test('callStripe shapes args: retrieve takes (id, params, opts)', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'retrieve', {id: 'cus_9', options: {}});
  assert.deepEqual(c.calls[0], ['customers.retrieve', 'cus_9', {}]);
});

test('callStripe with all uses autoPagingToArray', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'customers', 'list', {params: {}, options: {}, all: true, limit: 5000});
  assert.equal(out.length, 2);
  assert.deepEqual(c.calls[1], ['autopage', 5000]);
});

test('genIdempotencyKey returns a unique prefixed key', () => {
  const a = genIdempotencyKey();
  const b = genIdempotencyKey();
  assert.notEqual(a, b);
  assert.match(a, /^stripex-[0-9a-f-]{36}$/);
});
