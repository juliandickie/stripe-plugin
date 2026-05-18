const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('README covers install, accounts, safety, and the pinned versions', () => {
  const r = fs.readFileSync(__dirname + '/../README.md', 'utf8');
  for (const s of ['/plugin marketplace add', 'accounts.json', 'live-mode arming', 'stripe-node', '22.1.1']) {
    assert.ok(r.includes(s), 'README missing: ' + s);
  }
});

test('LICENSE is MIT and CHANGELOG records the pinned API version', () => {
  assert.match(fs.readFileSync(__dirname + '/../LICENSE', 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(__dirname + '/../CHANGELOG.md', 'utf8'), /2026-04-22\.dahlia/);
});
