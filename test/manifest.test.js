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

// --- Version single-source drift guard ---
//
// The MCP shim used to report a hardcoded serverInfo version. It said 0.1.0
// and was already wrong by the 0.2.0 release, because a second copy of a
// version number is only ever correct until the next bump. These pin the
// rule that the manifest is the one source, in the same spirit as the guard
// flag sets being pinned against src/cli.js parseArgs.

test('plugin.json and package.json declare the same version', () => {
  const plugin = JSON.parse(fs.readFileSync(__dirname + '/../.claude-plugin/plugin.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8'));
  assert.equal(plugin.version, pkg.version);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, 'version must be plain semver');
});

test('the MCP shim reports the manifest version rather than a copy of it', () => {
  const src = fs.readFileSync(__dirname + '/../src/mcp_shim_server.js', 'utf8');
  // It must read the manifest...
  assert.match(src, /require\(['"]\.\.\/\.claude-plugin\/plugin\.json['"]\)\.version/);
  // ...and serverInfo must use that value, not a literal.
  assert.match(src, /serverInfo:\s*\{[^}]*version:\s*VERSION/);
  // Belt and braces: no quoted semver may appear as a version value anywhere
  // in the file, which is the exact shape that went stale.
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /version:\s*['"]\d+\.\d+\.\d+['"]/);
});

test('the CHANGELOG documents the current version', () => {
  const plugin = JSON.parse(fs.readFileSync(__dirname + '/../.claude-plugin/plugin.json', 'utf8'));
  const log = fs.readFileSync(__dirname + '/../CHANGELOG.md', 'utf8');
  assert.ok(log.includes('## ' + plugin.version + ' - '),
    'CHANGELOG has no released section for version ' + plugin.version);
});
