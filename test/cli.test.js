const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {run, EXIT} = require('../src/cli');

function setup(accounts) {
  const dir = path.join(os.tmpdir(), 'cli-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(dir, {recursive: true});
  const regPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(regPath, JSON.stringify(accounts));
  return {dir: dir, regPath: regPath};
}

const ACCOUNTS = {
  default_account: 'idd',
  accounts: {
    idd: {type: 'standalone', test_secret_key: 'sk_test_idd', live_secret_key: 'sk_live_idd'},
    acme: {type: 'connect', platform: 'idd', connected_account: 'acct_ACME'}
  }
};

function fakeFactory(record, opts) {
  const failIds = (opts && opts.failIds) || [];
  return (cfg) => ({
    customers: {
      // Real stripe-node arity: list(params, opts) -> .length 2.
      list: (p, o) => { record.push({apiKey: cfg.apiKey, stripeAccount: cfg.stripeAccount, op: 'list', p: p}); return {autoPagingToArray: async () => [{id: 'cus_1'}]}; },
      create: async (p) => { record.push({apiKey: cfg.apiKey, stripeAccount: cfg.stripeAccount, op: 'create', p: p}); return {id: 'cus_new'}; },
      // Instance ops keep the real (id, params, opts) arity so the dispatch
      // arity guard behaves exactly as against the live SDK.
      del: async (id, p, o) => {
        record.push({apiKey: cfg.apiKey, stripeAccount: cfg.stripeAccount, op: 'del', id: id});
        if (failIds.indexOf(id) >= 0) { const e = new Error('boom for ' + id); e.code = 'resource_missing'; throw e; }
        return {id: id, deleted: true};
      },
      update: async (id, p, o) => {
        record.push({apiKey: cfg.apiKey, stripeAccount: cfg.stripeAccount, op: 'update', id: id, p: p});
        return {id: id};
      }
    },
    paymentIntents: {
      cancel: async (id, p, o) => { record.push({apiKey: cfg.apiKey, op: 'paymentIntents.cancel', id: id}); return {id: id, status: 'canceled'}; }
    },
    balance: {
      retrieve: async (p, o) => { record.push({apiKey: cfg.apiKey, op: 'balance.retrieve'}); return {object: 'balance'}; }
    }
  });
}

test('read runs immediately and returns data', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'list', '--account', 'idd', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  assert.equal(rec[0].apiKey, 'sk_test_idd');
});

test('mutating without --confirm prints preview and exits 10, no SDK call', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'create', '--account', 'idd', '--data', 'email=a@b.co', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 10);
  assert.match(r.stdout, /CONFIRMATION REQUIRED/);
  assert.match(r.stdout, /class: mutating/);
  assert.equal(rec.length, 0);
});

test('mutating with --confirm executes', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'create', '--account', 'idd', '--data', 'email=a@b.co', '--confirm', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  assert.equal(rec[0].p.email, 'a@b.co');
});

test('live write without --arm-live is refused (exit 12)', async () => {
  const s = setup(ACCOUNTS);
  const r = await run(['customers', 'create', '--account', 'idd', '--data', 'email=a@b.co', '--confirm', '--live', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 12);
  assert.match(r.stdout, /live mode not armed/i);
});

test('fan-out write is refused (exit 13)', async () => {
  const s = setup(ACCOUNTS);
  const r = await run(['customers', 'create', '--account', 'all', '--data', 'email=a@b.co', '--confirm', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 13);
  assert.match(r.stdout, /fan-out refuses/i);
});

test('fan-out read tags results per account', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'list', '--account', 'all', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.results.length, 2);
  assert.deepEqual(out.results.map((x) => x.account).sort(), ['acme', 'idd']);
});

test('bulk write over threshold without --confirm-bulk returns scope review (exit 11)', async () => {
  const s = setup(ACCOUNTS);
  const ids = Array.from({length: 12}, (_, i) => 'cus_' + i).join(',');
  const r = await run(['customers', 'del', '--account', 'idd', '--bulk-ids', ids, '--confirm', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir, CLAUDE_PLUGIN_OPTION_BULK_THRESHOLD: '10'}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 11);
  const out = JSON.parse(r.stdout);
  assert.equal(out.kind, 'scope_review_required');
  assert.equal(out.count, 12);
});

test('buildParams does not pollute Object.prototype via --data', async () => {
  const s = setup(ACCOUNTS);
  const r = await run(['customers', 'create', '--account', 'idd', '--data', '__proto__[polluted]=yes', '--data', 'constructor[bad]=x', '--data', 'email=a@b.co', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory([])});
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).bad, undefined);
  // still a normal (mutating) op: preview, exit 10
  assert.equal(r.exitCode, 10);
});

test('live mutating with --arm-live and --confirm executes (positive armed path)', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'create', '--account', 'idd', '--data', 'email=a@b.co', '--live', '--arm-live', '--confirm', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir, CLAUDE_SESSION_ID: 'sess-1'}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  assert.equal(rec[0].apiKey, 'sk_live_idd');
});

test('invalid --params JSON returns USAGE (exit 2), not a crash', async () => {
  const s = setup(ACCOUNTS);
  const r = await run(['customers', 'create', '--account', 'idd', '--params', '{not json', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /Usage error/);
});

test('help lists operations for a resource from the api-map (no registry, no network)', async () => {
  const r = await run(['help', 'customers'], {env: {}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /customers\.create\s+\[POST\]/);
  assert.match(r.stdout, /customers\.list\s+\[GET\]/);
});

test('bare help prints usage and the discovery hint', async () => {
  const r = await run(['help'], {env: {}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /stripe-x help <resource\.path>/);
});

test('help for an unknown resource suggests nearby and does not crash or confirm', async () => {
  const r = await run(['help', 'custmoers'], {env: {}, stripeFactory: fakeFactory([])});
  assert.equal(r.exitCode, 0);
  assert.doesNotMatch(r.stdout, /CONFIRMATION REQUIRED/);
});

test('bulk del under threshold with --confirm --confirm-bulk iterates every id (fail-loud aggregate)', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'del', '--account', 'idd', '--bulk-ids', 'cus_1,cus_2,cus_3', '--confirm', '--confirm-bulk', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir, CLAUDE_PLUGIN_OPTION_BULK_THRESHOLD: '10'}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  const dels = rec.filter((x) => x.op === 'del');
  assert.equal(dels.length, 3);
  assert.deepEqual(dels.map((x) => x.id), ['cus_1', 'cus_2', 'cus_3']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.succeeded, 3);
  assert.equal(out.failed, 0);
  assert.equal(out.results.length, 3);
});

test('bulk del where one id errors -> aggregate ok:false, exit 1, other ids still attempted', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'del', '--account', 'idd', '--bulk-ids', 'cus_1,cus_BAD,cus_3', '--confirm', '--confirm-bulk', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec, {failIds: ['cus_BAD']})});
  assert.equal(r.exitCode, 1);
  const dels = rec.filter((x) => x.op === 'del');
  assert.deepEqual(dels.map((x) => x.id), ['cus_1', 'cus_BAD', 'cus_3']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.succeeded, 2);
  assert.equal(out.failed, 1);
  assert.match(out.summary, /cus_BAD failed:/);
});

test('bulk over threshold without --confirm-bulk still returns scope review (exit 11), no calls', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const ids = Array.from({length: 12}, (_, i) => 'cus_' + i).join(',');
  const r = await run(['customers', 'del', '--account', 'idd', '--bulk-ids', ids, '--confirm', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir, CLAUDE_PLUGIN_OPTION_BULK_THRESHOLD: '10'}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 11);
  const out = JSON.parse(r.stdout);
  assert.equal(out.kind, 'scope_review_required');
  assert.equal(out.count, 12);
  assert.equal(rec.length, 0);
});

test('bulk without --confirm -> CONFIRMATION REQUIRED preview, exit 10, no calls, mentions N targets', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'del', '--account', 'idd', '--bulk-ids', 'cus_1,cus_2,cus_3', '--confirm-bulk', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 10);
  assert.match(r.stdout, /CONFIRMATION REQUIRED/);
  assert.match(r.stdout, /bulk: 3 targets/);
  assert.match(r.stdout, /targets: cus_1,cus_2,cus_3/);
  assert.match(r.stdout, /class: destructive/);
  assert.equal(rec.length, 0);
});

test('preview shows target id for an instance update (no --confirm)', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'update', '--id', 'cus_9', '--account', 'idd', '--data', 'name=X', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 10);
  assert.match(r.stdout, /target id: cus_9/);
  assert.equal(rec.length, 0);
});

test('preview shows target id (none) for a no-id mutating create', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'create', '--account', 'idd', '--data', 'email=a@b.co', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 10);
  assert.match(r.stdout, /target id: \(none\)/);
  assert.equal(rec.length, 0);
});

test('instance op with no --id is rejected with exit 1 and the SDK method is NOT called', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['paymentIntents', 'cancel', '--account', 'idd', '--confirm', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /requires --id/);
  assert.equal(rec.filter((x) => x.op === 'paymentIntents.cancel').length, 0);
});

test('singleton balance retrieve with no id still works (guard does not false-positive)', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['balance', 'retrieve', '--account', 'idd', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.object, 'balance');
});

test('--limit on a plain (non --all) list is passed to Stripe as params.limit', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'list', '--account', 'idd', '--limit', '3', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
  const listCall = rec.find((x) => x.op === 'list');
  assert.ok(listCall, 'list was called');
  assert.equal(listCall.p.limit, 3);
});

test('--data with no = returns USAGE (exit 2), not a corrupt param', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'create', '--account', 'idd', '--data', 'bogusnoeq', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /requires key=value/);
  assert.equal(rec.length, 0);
});

// ---- cli wrapper (engine-enforced per-account key + trigger-live block) ----

const CLI_VERSION = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stripe-cli-version.txt'), 'utf8').trim();

// Materialize the pinned bundled binary so resolveCliBinary's path exists and
// the spawn branch is reached (the handler refuses if the binary is absent).
function provisionBinary(dir) {
  const binDir = path.join(dir, 'stripe-cli', CLI_VERSION);
  fs.mkdirSync(binDir, {recursive: true});
  const bin = path.join(binDir, 'stripe');
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(bin, 0o755);
  return bin;
}

// Recording fake spawn: never execs anything; records (bin,args) and returns {status:0}.
function recordingSpawn(calls) {
  return (bin, args, opts) => { calls.push({bin: bin, args: args, opts: opts}); return {status: 0}; };
}

test('cli trigger in live is binary-refused before any spawn (no exec, no key leak)', async () => {
  const s = setup(ACCOUNTS);
  provisionBinary(s.dir);
  const calls = [];
  const r = await run(['cli', 'trigger', 'payment_intent.succeeded', '--account', 'idd', '--live', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, cliSpawn: recordingSpawn(calls)});
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stdout, /blocked in live/i);
  assert.equal(calls.length, 0);
  assert.ok(r.stdout.indexOf('sk_test_idd') < 0 && r.stdout.indexOf('sk_live_idd') < 0, 'no key in output');
});

test('cli trigger in test mode injects the resolved TEST key and runs once', async () => {
  const s = setup(ACCOUNTS);
  provisionBinary(s.dir);
  const calls = [];
  const r = await run(['cli', 'trigger', 'payment_intent.succeeded', '--account', 'idd', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, cliSpawn: recordingSpawn(calls)});
  assert.equal(r.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.indexOf('trigger') >= 0, 'subcommand passed through');
  assert.ok(calls[0].args.indexOf('--api-key') >= 0, '--api-key injected');
  assert.ok(calls[0].args.indexOf('sk_test_idd') >= 0, 'resolved TEST key injected');
});

test('cli listen on a connect account injects platform key AND --stripe-account', async () => {
  const s = setup(ACCOUNTS);
  provisionBinary(s.dir);
  const calls = [];
  const r = await run(['cli', 'listen', '--account', 'acme', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, cliSpawn: recordingSpawn(calls)});
  assert.equal(r.exitCode, 0);
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  assert.ok(args.indexOf('--api-key') >= 0 && args.indexOf('sk_test_idd') >= 0, 'platform key injected');
  assert.ok(args.indexOf('--stripe-account') >= 0 && args.indexOf('acct_ACME') >= 0, 'connected account injected');
});

test('cli with an unknown account is refused (EXIT.ERROR) and never spawns', async () => {
  const s = setup(ACCOUNTS);
  provisionBinary(s.dir);
  const calls = [];
  const r = await run(['cli', 'listen', '--account', 'nope', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, cliSpawn: recordingSpawn(calls)});
  assert.equal(r.exitCode, EXIT.ERROR);
  assert.equal(calls.length, 0);
});

test('cli with no subcommand returns USAGE (exit 2)', async () => {
  const s = setup(ACCOUNTS);
  provisionBinary(s.dir);
  const calls = [];
  const r = await run(['cli', '--account', 'idd', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, cliSpawn: recordingSpawn(calls)});
  assert.equal(r.exitCode, EXIT.USAGE);
  assert.equal(calls.length, 0);
});

test('cli when the resolved binary is absent refuses with /not provisioned/ and never spawns', async () => {
  const s = setup(ACCOUNTS); // note: no provisionBinary -> path is absent
  const r = await run(['cli', 'listen', '--account', 'idd', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir},
      cliSpawn: () => { throw new Error('spawn must not be reached when binary is absent'); }});
  assert.equal(r.exitCode, EXIT.ERROR);
  assert.match(r.stdout, /not provisioned/);
});

test('create + --bulk-ids is refused fail-loud (incoherent combo)', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'create', '--account', 'idd', '--bulk-ids', 'cus_1,cus_2', '--confirm', '--confirm-bulk', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /bulk-ids cannot be combined with a create/i);
  assert.equal(rec.length, 0); // never executed
});

test('instance-op bulk still works after the create+bulk guard', async () => {
  const s = setup(ACCOUNTS);
  const rec = [];
  const r = await run(['customers', 'del', '--account', 'idd', '--bulk-ids', 'cus_1,cus_2,cus_3', '--confirm', '--confirm-bulk', '--accounts-file', s.regPath],
    {env: {CLAUDE_PLUGIN_DATA: s.dir}, stripeFactory: fakeFactory(rec)});
  assert.equal(r.exitCode, 0);
});

test('cli engine output never leaks the resolved api key across paths', async () => {
  const s = setup(ACCOUNTS);
  provisionBinary(s.dir);
  const calls = [];
  const outs = [];
  for (const argv of [
    ['cli', 'trigger', 'pi.succeeded', '--account', 'idd', '--live', '--accounts-file', s.regPath],
    ['cli', 'trigger', 'pi.succeeded', '--account', 'idd', '--accounts-file', s.regPath],
    ['cli', 'listen', '--account', 'acme', '--accounts-file', s.regPath],
    ['cli', '--account', 'idd', '--accounts-file', s.regPath]
  ]) {
    const r = await run(argv, {env: {CLAUDE_PLUGIN_DATA: s.dir}, cliSpawn: recordingSpawn(calls)});
    outs.push(r.stdout);
  }
  const joined = outs.join('\n');
  assert.ok(joined.indexOf('sk_test_idd') < 0, 'test key must not leak into engine output');
  assert.ok(joined.indexOf('sk_live_idd') < 0, 'live key must not leak into engine output');
});
