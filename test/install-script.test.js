const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('pinned version file is a concrete semver', () => {
  const v = fs.readFileSync(__dirname + '/../scripts/stripe-cli-version.txt', 'utf8').trim();
  assert.match(v, /^\d+\.\d+\.\d+$/);
});

test('install script is executable with shebang, strict mode, and checksum verify', () => {
  const p = __dirname + '/../scripts/install-stripe-cli.sh';
  fs.accessSync(p, fs.constants.X_OK);
  const s = fs.readFileSync(p, 'utf8');
  assert.match(s, /^#!\/usr\/bin\/env bash/);
  assert.match(s, /set -euo pipefail/);
  assert.match(s, /shasum -a 256 -c/);
  assert.match(s, /stripe-cli-version\.txt/);
});

test('hooks.json declares a SessionStart command hook', () => {
  const h = JSON.parse(fs.readFileSync(__dirname + '/../hooks/hooks.json', 'utf8'));
  assert.ok(Array.isArray(h.hooks.SessionStart));
  const cmd = h.hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, /install-stripe-cli\.sh/);
});
