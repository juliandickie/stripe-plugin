const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('agent has required frontmatter and states it cannot bypass the binary', () => {
  const s = fs.readFileSync(__dirname + '/../agents/stripe-bulk-runner.md', 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m);
  assert.match(m[1], /name:\s*stripe-bulk-runner/);
  assert.match(m[1], /description:\s*.+/);
  assert.match(s, /cannot bypass|enforced by the binary|scope review/i);
});
