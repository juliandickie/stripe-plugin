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
