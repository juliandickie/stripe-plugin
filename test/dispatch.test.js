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
      retrieve: async (id, params, opts) => { calls.push(['customers.retrieve', id, params, opts]); return {id: id}; },
      update: async (id, params, opts) => { calls.push(['customers.update', id, params, opts]); return {id: id}; },
      del: async (id, params, opts) => { calls.push(['customers.del', id, params, opts]); return {id: id, deleted: true}; },
      list: (params, opts) => { calls.push(['customers.list', params, opts]); return listReturn; }
    },
    paymentIntents: {
      confirm: async (id, params, opts) => { calls.push(['paymentIntents.confirm', id, params, opts]); return {id: id, status: 'succeeded'}; }
    },
    balance: {
      retrieve: async (params, opts) => { calls.push(['balance.retrieve', params, opts]); return {object: 'balance'}; }
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

test('callStripe shapes args: create takes (params, opts), no id', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'customers', 'create', {params: {email: 'a@b.co'}, options: {idempotencyKey: 'k1'}});
  assert.equal(out.id, 'cus_1');
  assert.deepEqual(c.calls[0], ['customers.create', {email: 'a@b.co'}, {idempotencyKey: 'k1'}]);
});

test('callStripe shapes args: retrieve with id takes (id, params, opts)', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'retrieve', {id: 'cus_9', options: {}});
  assert.deepEqual(c.calls[0], ['customers.retrieve', 'cus_9', {}, {}]);
});

test('callStripe shapes args: update with id takes (id, params, opts)', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'update', {id: 'cus_9', params: {name: 'X'}, options: {}});
  assert.deepEqual(c.calls[0], ['customers.update', 'cus_9', {name: 'X'}, {}]);
});

test('callStripe shapes args: del with id takes (id, params, opts)', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'del', {id: 'cus_9', options: {}});
  assert.deepEqual(c.calls[0], ['customers.del', 'cus_9', {}, {}]);
});

test('callStripe routes any id-first action by id presence (no allowlist): paymentIntents.confirm', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'paymentIntents', 'confirm', {id: 'pi_9', params: {payment_method: 'pm_1'}, options: {}});
  assert.equal(out.status, 'succeeded');
  assert.deepEqual(c.calls[0], ['paymentIntents.confirm', 'pi_9', {payment_method: 'pm_1'}, {}]);
});

test('callStripe handles singleton no-id retrieve: balance.retrieve takes (params, opts)', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'balance', 'retrieve', {options: {}});
  assert.equal(out.object, 'balance');
  assert.deepEqual(c.calls[0], ['balance.retrieve', {}, {}]);
});

test('callStripe with all uses autoPagingToArray', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'customers', 'list', {params: {}, options: {}, all: true, limit: 5000});
  assert.equal(out.length, 2);
  assert.deepEqual(c.calls[1], ['autopage', 5000]);
});

test('callStripe plain list passes req.limit through as params.limit', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'list', {params: {}, options: {}, limit: 5});
  assert.equal(c.calls[0][0], 'customers.list');
  assert.equal(c.calls[0][1].limit, 5);
});

test('callStripe --all --limit 0 caps autopage at 0, not 10000', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'list', {params: {}, options: {}, all: true, limit: 0});
  assert.deepEqual(c.calls[1], ['autopage', 0]);
});

test('callStripe --all with no limit still caps autopage at 10000', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'list', {params: {}, options: {}, all: true});
  assert.deepEqual(c.calls[1], ['autopage', 10000]);
});

test('callStripe rejects instance op invoked with no id (arity guard)', async () => {
  const c = fakeClient();
  await assert.rejects(
    () => callStripe(c, 'customers', 'del', {options: {}}),
    /requires --id \(instance operation\)/
  );
  // the fake del must NOT have been called
  assert.equal(c.calls.length, 0);
});

test('callStripe arity guard does not false-positive on no-id singleton retrieve', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'balance', 'retrieve', {options: {}});
  assert.equal(out.object, 'balance');
  assert.deepEqual(c.calls[0], ['balance.retrieve', {}, {}]);
});

test('callStripe arity guard does not block create with no id', async () => {
  const c = fakeClient();
  const out = await callStripe(c, 'customers', 'create', {params: {email: 'a@b.co'}, options: {}});
  assert.equal(out.id, 'cus_1');
});

test('callStripe does not mutate caller req.params when injecting expand', async () => {
  const c = fakeClient();
  const sharedParams = {email: 'a@b.co'};
  await callStripe(c, 'customers', 'create', {params: sharedParams, expand: ['default_source'], options: {idempotencyKey: 'k'}});
  assert.deepEqual(sharedParams, {email: 'a@b.co'});
});

test('callStripe auto-injects an idempotency key on create when absent', async () => {
  const c = fakeClient();
  await callStripe(c, 'customers', 'create', {params: {email: 'x@y.z'}, options: {}});
  const opts = c.calls[0][2];
  assert.match(opts.idempotencyKey, /^stripex-[0-9a-f-]{36}$/);
});

test('genIdempotencyKey returns a unique prefixed key', () => {
  const a = genIdempotencyKey();
  const b = genIdempotencyKey();
  assert.notEqual(a, b);
  assert.match(a, /^stripex-[0-9a-f-]{36}$/);
});
