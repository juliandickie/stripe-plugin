const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {shouldRun, listTools, toArgv} = require('../src/mcp_shim');

test('shim is opt-in via enable_mcp_shim', () => {
  assert.equal(shouldRun({}), false);
  assert.equal(shouldRun({CLAUDE_PLUGIN_OPTION_ENABLE_MCP_SHIM: 'false'}), false);
  assert.equal(shouldRun({CLAUDE_PLUGIN_OPTION_ENABLE_MCP_SHIM: 'true'}), true);
});

test('exposes exactly stripe_call and stripe_accounts', () => {
  const names = listTools().map((t) => t.name).sort();
  assert.deepEqual(names, ['stripe_accounts', 'stripe_call']);
});

test('toArgv mirrors the CLI grammar', () => {
  const v = toArgv({resource: 'customers', action: 'list', account: 'idd', all: true});
  assert.deepEqual(v, ['customers', 'list', '--account', 'idd', '--all']);
});

test('.mcp.json points at the shim server entry', () => {
  const j = JSON.parse(fs.readFileSync(__dirname + '/../.mcp.json', 'utf8'));
  const srv = j.mcpServers['stripe-shim'];
  assert.match(srv.command, /node/);
  assert.match(JSON.stringify(srv.args), /mcp_shim_server/);
});

test('server: opt-in gate exits 0 when disabled (no stdin processing)', () => {
  const {spawnSync} = require('node:child_process');
  const r = spawnSync(process.execPath, [__dirname + '/../src/mcp_shim_server.js'],
    {input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n', env: {}, encoding: 'utf8'});
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('server: malformed line is skipped, valid tools/list still answered (enabled)', () => {
  const {spawnSync} = require('node:child_process');
  const r = spawnSync(process.execPath, [__dirname + '/../src/mcp_shim_server.js'],
    {input: '{bad json\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
     env: {CLAUDE_PLUGIN_OPTION_ENABLE_MCP_SHIM: 'true'}, encoding: 'utf8', timeout: 10000});
  assert.match(r.stdout, /stripe_call/);
  assert.match(r.stdout, /stripe_accounts/);
});

test('toArgv maps the full CLI grammar including bulk_ids and limit', () => {
  const v = toArgv({resource: 'customers', action: 'del', account: 'idd', bulk_ids: ['a','b'], limit: 5, table: true, confirm: true, confirm_bulk: true});
  assert.ok(v.includes('--bulk-ids') && v.includes('a,b'));
  assert.ok(v.includes('--limit') && v.includes('5'));
  assert.ok(v.includes('--table'));
  assert.ok(v.includes('--confirm-bulk'));
});

test('listTools advertises stripe_accounts and stripe_call with full schema', () => {
  const {listAccounts} = require('../src/mcp_shim');
  assert.equal(typeof listAccounts, 'function');
  const call = listTools().find((t) => t.name === 'stripe_call');
  for (const k of ['limit','api_version','idempotency_key','bulk_ids','table','accounts_file']) {
    assert.ok(call.inputSchema.properties[k], 'schema missing ' + k);
  }
});

test('listAccounts returns no secret values', () => {
  const {listAccounts} = require('../src/mcp_shim');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const d = path.join(os.tmpdir(), 'shimacct-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(path.join(d, 'stripe-x'), {recursive: true});
  const rp = path.join(d, 'stripe-x', 'accounts.json');
  fs.writeFileSync(rp, JSON.stringify({default_account: 'x', accounts: {x: {type: 'standalone', label: 'X', test_secret_key: 'env:T', live_secret_key: 'op://V/I/live'}}}));
  const res = listAccounts({CLAUDE_PLUGIN_DATA: d});
  const json = JSON.stringify(res);
  assert.ok(!json.includes('sk_test_SECRETVAL') && !json.includes('sk_live_SECRETVAL'));
  assert.equal(res.accounts.x.has_test_key, true);
});
