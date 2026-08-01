const {test} = require('node:test');
const assert = require('node:assert/strict');
const {decide} = require('../hooks/pretooluse-stripe-guard');

function ev(command, permission_mode, overrides) {
  return Object.assign({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    permission_mode: permission_mode, tool_input: {command: command}
  }, overrides || {});
}

test('non-Bash and non-PreToolUse events defer', () => {
  assert.equal(decide(ev('stripe-x refunds create --live', 'auto', {tool_name: 'Read'})).permissionDecision, 'defer');
  assert.equal(decide(ev('stripe-x refunds create --live', 'auto', {hook_event_name: 'PostToolUse'})).permissionDecision, 'defer');
});

test('commands that do not mention the engine defer', () => {
  assert.equal(decide(ev('ls -la', 'auto')).permissionDecision, 'defer');
  assert.equal(decide(ev('git status', 'bypassPermissions')).permissionDecision, 'defer');
});

test('prompting modes always defer, even for live', () => {
  for (const m of ['default', 'plan', 'acceptEdits']) {
    assert.equal(decide(ev('stripe-x refunds create --live --confirm', m)).permissionDecision, 'defer', m);
  }
});

test('live is denied in every non-prompting mode', () => {
  for (const m of ['auto', 'dontAsk', 'bypassPermissions']) {
    const d = decide(ev('stripe-x refunds create --account idd --live --confirm', m));
    assert.equal(d.permissionDecision, 'deny', m);
  }
});

test('an unrecognised mode is treated as non-prompting', () => {
  assert.equal(decide(ev('stripe-x refunds create --live', 'someFutureMode')).permissionDecision, 'deny');
});

test('a test-mode write asks in a non-prompting mode', () => {
  assert.equal(decide(ev('stripe-x customers create --account idd --confirm', 'auto')).permissionDecision, 'ask');
  assert.equal(decide(ev('stripe-x customers del --id cus_1 --confirm', 'auto')).permissionDecision, 'ask');
});

test('a read defers even in a non-prompting mode', () => {
  assert.equal(decide(ev('stripe-x customers list --account idd', 'auto')).permissionDecision, 'defer');
  assert.equal(decide(ev('stripe-x charges retrieve --id ch_1', 'auto')).permissionDecision, 'defer');
});

test('help is read-only and defers', () => {
  assert.equal(decide(ev('stripe-x help customers', 'auto')).permissionDecision, 'defer');
});

test('the cli bridge is treated as at least mutating', () => {
  assert.equal(decide(ev('stripe-x cli trigger payment_intent.succeeded', 'auto')).permissionDecision, 'ask');
});

test('shell ambiguity with a live flag still denies', () => {
  for (const c of [
    'stripe-x customers list; stripe-x refunds create --live --confirm',
    'eval "stripe-x refunds create --live --confirm"'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('shell ambiguity without a live flag asks rather than allows', () => {
  for (const c of [
    'stripe-x customers list && rm -rf /',
    'stripe-x refunds create $(cat flags.txt)',
    'stripe-x refunds create `cat flags.txt`'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'ask', c);
  }
});

test('an absolute path to the engine is still matched', () => {
  const d = decide(ev('/Users/j/.claude/plugins/cache/outfit/stripe/0.1.0/bin/stripe-x refunds create --live', 'auto'));
  assert.equal(d.permissionDecision, 'deny');
});

test('a nested shell invocation cannot smuggle a live call past the guard', () => {
  for (const c of [
    'bash -c "stripe-x refunds create --live --confirm"',
    "sh -c 'stripe-x refunds create --live --confirm'",
    'zsh -c "stripe-x refunds create --live"'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('a quoted engine token cannot smuggle a live call past the guard', () => {
  for (const c of [
    '"stripe-x" refunds create --live',
    "'stripe-x' refunds create --live --confirm",
    '"stripe-x" refunds create --live --confirm'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('a quoted engine token on a read cannot be proven simple, so it asks', () => {
  assert.equal(decide(ev('"stripe-x" customers list --account idd', 'auto')).permissionDecision, 'ask');
});

test('mentioning the engine while unlocatable fails closed', () => {
  // Pre-gate matches on the substring, but no token resolves to the engine.
  assert.equal(decide(ev('echo my-stripe-xylophone --live', 'auto')).permissionDecision, 'deny');
});

test('a value-taking flag does not shift the positional parse', () => {
  // --account takes a value; "idd" must not be mistaken for the action.
  assert.equal(decide(ev('stripe-x --account idd customers list', 'auto')).permissionDecision, 'defer');
});

test('a missing action asks rather than throwing', () => {
  assert.equal(decide(ev('stripe-x customers', 'auto')).permissionDecision, 'ask');
});

test('the reason never echoes the command', () => {
  const d = decide(ev('stripe-x refunds create --live --data secret=sk_live_LEAK', 'auto'));
  assert.equal(d.permissionDecision, 'deny');
  assert.ok(!/sk_live_LEAK/.test(d.permissionDecisionReason));
});

test('malformed input defers rather than blocking every Bash call', () => {
  assert.equal(decide(null).permissionDecision, 'defer');
  assert.equal(decide({}).permissionDecision, 'defer');
});

test('quote splicing inside a token cannot smuggle a live call', () => {
  for (const c of [
    'stripe-x refunds create --account idd --li"ve" --confirm',
    "stripe-x refunds create --li've' --confirm",
    'stripe-x refunds create --li\\ve --confirm'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('splicing the engine name itself cannot evade the guard', () => {
  const c = 'st"ripe-x" refunds create --account idd --live --confirm';
  assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
});

test('a case-variant engine name is still the engine', () => {
  assert.equal(decide(ev('STRIPE-X refunds create --live --confirm', 'auto')).permissionDecision, 'deny');
  assert.equal(decide(ev('Stripe-X refunds create --LIVE', 'auto')).permissionDecision, 'deny');
});

test('a nested shell with a spliced live flag is still denied', () => {
  const c = '/bin/bash -c \'stripe-x refunds create --li"ve" --confirm\'';
  assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
});

test('defer is reachable only for a provably simple read', () => {
  assert.equal(decide(ev('stripe-x customers list --account idd', 'auto')).permissionDecision, 'defer');
  assert.equal(decide(ev('stripe-x --account idd customers list', 'auto')).permissionDecision, 'defer');
  assert.equal(decide(ev('stripe-x help customers', 'auto')).permissionDecision, 'defer');
  // Same read, but quoted, so simplicity cannot be proven.
  assert.equal(decide(ev('"stripe-x" customers list', 'auto')).permissionDecision, 'ask');
});
