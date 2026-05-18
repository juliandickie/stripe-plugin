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

test('stripe-api documents the dispatcher grammar and is model-invocable', () => {
  const f = fm(__dirname + '/../skills/stripe-api/SKILL.md');
  assert.match(f.front, /name:\s*stripe-api/);
  assert.ok(!/disable-model-invocation:\s*true/.test(f.front));
  assert.match(f.raw, /stripe-x <resource\.path> <action>/);
  assert.match(f.raw, /--confirm/);
  assert.match(f.raw, /--account/);
});

test('read-only skills exist and are model-invocable', () => {
  for (const n of ['stripe-accounts', 'stripe-multi-account', 'stripe-reports']) {
    const f = fm(__dirname + '/../skills/' + n + '/SKILL.md');
    assert.match(f.front, new RegExp('name:\\s*' + n));
  }
  const acc = fm(__dirname + '/../skills/stripe-accounts/SKILL.md');
  assert.match(acc.raw, /last 4|mask/i);
  const ma = fm(__dirname + '/../skills/stripe-multi-account/SKILL.md');
  assert.match(ma.raw, /--account all/);
});

test('stripe-money-ops is user-only and stripe-webhooks documents the bundled CLI', () => {
  const mo = fm(__dirname + '/../skills/stripe-money-ops/SKILL.md');
  assert.match(mo.front, /name:\s*stripe-money-ops/);
  assert.match(mo.front, /disable-model-invocation:\s*true/);
  assert.match(mo.raw, /refund|payout|transfer/i);
  const wh = fm(__dirname + '/../skills/stripe-webhooks/SKILL.md');
  assert.match(wh.raw, /stripe listen|stripe trigger/);
  assert.match(wh.raw, /live/);
});
