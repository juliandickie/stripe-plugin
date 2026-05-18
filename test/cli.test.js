const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {run} = require('../src/cli');

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

function fakeFactory(record) {
  return (cfg) => ({
    customers: {
      list: (p, o) => { record.push({apiKey: cfg.apiKey, stripeAccount: cfg.stripeAccount}); return {autoPagingToArray: async () => [{id: 'cus_1'}]}; },
      create: async (p) => { record.push({apiKey: cfg.apiKey, stripeAccount: cfg.stripeAccount, p: p}); return {id: 'cus_new'}; }
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
