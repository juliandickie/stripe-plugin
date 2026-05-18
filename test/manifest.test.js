const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('plugin.json has required fields and four userConfig keys', () => {
  const m = JSON.parse(fs.readFileSync(__dirname + '/../.claude-plugin/plugin.json', 'utf8'));
  assert.equal(m.name, 'stripe');
  assert.ok(m.version);
  assert.equal(m.license, 'MIT');
  const keys = Object.keys(m.userConfig).sort();
  assert.deepEqual(keys, ['accounts_file', 'bulk_threshold', 'default_account', 'enable_mcp_shim']);
  assert.equal(m.userConfig.bulk_threshold.default, 10);
  assert.equal(m.userConfig.enable_mcp_shim.default, false);
});

test('self-marketplace lists only this plugin', () => {
  const mk = JSON.parse(fs.readFileSync(__dirname + '/../.claude-plugin/marketplace.json', 'utf8'));
  assert.equal(mk.plugins.length, 1);
  assert.equal(mk.plugins[0].name, 'stripe');
});
