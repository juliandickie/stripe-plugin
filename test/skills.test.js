const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function fm(file) {
  const s = fs.readFileSync(file, 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'frontmatter missing in ' + file);
  return {raw: s, front: m[1]};
}

test('stripe-setup is user-only and documents registry scaffolding', () => {
  const f = fm(__dirname + '/../skills/stripe-setup/SKILL.md');
  assert.match(f.front, /name:\s*stripe-setup/);
  assert.match(f.front, /disable-model-invocation:\s*true/);
  assert.match(f.raw, /accounts\.json/);
  assert.match(f.raw, /chmod 600/);
});
