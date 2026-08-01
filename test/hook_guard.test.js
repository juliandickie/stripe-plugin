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

test('shell ambiguity denies rather than allows', () => {
  for (const c of [
    'stripe-x customers list; stripe-x refunds create --live --confirm',
    'stripe-x customers list && rm -rf /',
    'eval "stripe-x refunds create --live --confirm"',
    'stripe-x refunds create $(cat flags.txt)',
    'stripe-x refunds create `cat flags.txt`'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('an absolute path to the engine is still matched', () => {
  const d = decide(ev('/Users/j/.claude/plugins/cache/outfit/stripe/0.1.0/bin/stripe-x refunds create --live', 'auto'));
  assert.equal(d.permissionDecision, 'deny');
});

test('a value-taking flag does not shift the positional parse', () => {
  // --account takes a value; "idd" must not be mistaken for the action.
  assert.equal(decide(ev('stripe-x --account idd customers list', 'auto')).permissionDecision, 'defer');
});

test('a missing action denies rather than throwing', () => {
  assert.equal(decide(ev('stripe-x customers', 'auto')).permissionDecision, 'deny');
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
