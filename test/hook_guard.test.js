const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {decide, mentionsEngine, VALUE_FLAGS, BOOLEAN_FLAGS} = require('../hooks/pretooluse-stripe-guard');
const {isVetted} = require('../src/vetting');

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

test('shell ambiguity without a live flag denies rather than allows', () => {
  // None of these are provably simple - SIMPLE_CHARS fails on &, $, (, ), ` -
  // so each now denies outright instead of asking: unverifiable shell syntax
  // on a command that mentions the engine cannot be shown free of a live
  // operation, so it refuses rather than prompting.
  for (const c of [
    'stripe-x customers list && rm -rf /',
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

test('a quoted engine token on a read cannot be proven simple, so it denies', () => {
  assert.equal(decide(ev('"stripe-x" customers list --account idd', 'auto')).permissionDecision, 'deny');
});

test('a substring engine mention with --live denies at the live check, not the unlocatable branch', () => {
  // "stripe-x" is a substring of "my-stripe-xylophone", so the mention gate
  // matches - but this command also contains a literal "--live", so it is
  // denied at the live check (the very next thing _decide tests) and never
  // reaches the token-resolution branch below. This case used to be
  // asserted under a name claiming to exercise that later branch; it never
  // did, because the live check always short-circuits first.
  assert.equal(decide(ev('echo my-stripe-xylophone --live', 'auto')).permissionDecision, 'deny');
});

test('a substring engine mention with no live flag genuinely reaches the unlocatable branch and asks', () => {
  // Same substring match, no "--live" this time, so nothing short-circuits
  // before token resolution: no token in the command equals "stripe-x" or
  // ends with "/stripe-x", so the guard asks rather than guessing.
  assert.equal(decide(ev('echo my-stripe-xylophone list', 'auto')).permissionDecision, 'ask');
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
  // Same read, but quoted, so simplicity cannot be proven - and unprovable
  // simplicity on a command that mentions the engine now denies, not defers.
  assert.equal(decide(ev('"stripe-x" customers list', 'auto')).permissionDecision, 'deny');
});

test('a chained second engine invocation is never classified by the first', () => {
  for (const c of [
    'stripe-x refunds list | stripe-x accounts del --id acct_123 --confirm',
    'stripe-x customers list | stripe-x customers del --id cus_123 --confirm',
    'stripe-x refunds list\nstripe-x accounts del --id acct_123 --confirm',
    'stripe-x refunds list & stripe-x accounts del --id acct_123 --confirm',
    'stripe-x help refunds | stripe-x accounts del --id acct_123 --confirm',
    'stripe-x a list | stripe-x b list | stripe-x accounts del --id x'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'ask', c);
  }
});

test('ANSI-C quoting reconstructs to --live and is denied', () => {
  assert.equal(decide(ev("stripe-x refunds create --li$'v'e --confirm", 'auto')).permissionDecision, 'deny');
  assert.equal(decide(ev('stripe-x refunds create --li$"v"e', 'auto')).permissionDecision, 'deny');
});

test('an unrecognised hyphen token is not silently skipped', () => {
  assert.equal(decide(ev('stripe-x --bogus help customers', 'auto')).permissionDecision, 'ask');
  assert.equal(decide(ev('stripe-x --bogus customers list', 'auto')).permissionDecision, 'ask');
});

test('the single-read defer path still works with real flags', () => {
  assert.equal(decide(ev('stripe-x charges retrieve --id ch_1 --expand data', 'auto')).permissionDecision, 'defer');
  assert.equal(decide(ev('stripe-x paymentIntents list --limit 5', 'auto')).permissionDecision, 'defer');
  assert.equal(decide(ev('stripe-x customers list --account idd --table', 'auto')).permissionDecision, 'defer');
});

test('shell redirection cannot shift a destructive call into the read slots', () => {
  for (const op of ['>', '>>', '2>', '<', '<<<', '&>']) {
    const c = 'stripe-x ' + op + ' list accounts del --id acct_123 --confirm';
    // Redirection characters fall outside SIMPLE_CHARS, so this now denies
    // rather than asking - still never reaches defer, the invariant this
    // test exists to protect.
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('shell constructs the guard never enumerated still fail closed', () => {
  for (const c of [
    'stripe-x $(id) list accounts del --id x',
    'stripe-x {a,b} list accounts del --id x',
    'stripe-x *.log list accounts del --id x',
    'stripe-x ~/x list accounts del --id x',
    'stripe-x <(cat f) list accounts del --id x'
  ]) {
    // None of these are in SIMPLE_CHARS, so each now denies outright - an
    // even stronger fail-closed than the ask these used to get.
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

test('a resource or action that is not an identifier is never classified', () => {
  assert.equal(decide(ev('stripe-x 123 list', 'auto')).permissionDecision, 'ask');
  assert.equal(decide(ev('stripe-x customers 9lives', 'auto')).permissionDecision, 'ask');
});

test('genuine reads with real flags still defer', () => {
  for (const c of [
    'stripe-x customers list --account idd',
    'stripe-x --account idd customers list',
    'stripe-x charges retrieve --id ch_1 --expand data',
    'stripe-x paymentIntents list --limit 5',
    'stripe-x customers list --account idd --table',
    'stripe-x customers list --data email=a@b.co',
    'stripe-x help customers'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'defer', c);
  }
});

test('the guard flag sets stay in sync with the engine parseArgs', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(__dirname + '/../src/cli.js', 'utf8');
  const parsed = new Set((src.match(/t === '(--[a-z-]+)'/g) || [])
    .map((m) => m.replace(/^t === '/, '').replace(/'$/, '')));
  const guarded = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);
  for (const f of parsed) {
    assert.ok(guarded.has(f), 'parseArgs knows ' + f + ' but the guard does not');
  }
  for (const f of guarded) {
    assert.ok(parsed.has(f), 'the guard knows ' + f + ' but parseArgs does not');
  }
});

test('command substitution that reconstructs --live at shell-execution time is denied (bypass 9b)', () => {
  // normalize() strips quotes, backslashes and $, but not the parentheses or
  // backticks that make substitution work, so the text the live check sees
  // is --li(echo v)e (or --li<backtick>echo v<backtick>e) - never the literal
  // substring "--live". Real bash executes `echo v` and splices the result
  // in, so this is a live call the text-only live check cannot see.
  // SIMPLE_CHARS catches the parentheses/backtick and now denies rather
  // than asking, which is the fix this test exists to prove.
  for (const c of [
    'stripe-x refunds create --li$(echo v)e --confirm',
    'stripe-x refunds create --li`echo v`e --confirm'
  ]) {
    assert.equal(decide(ev(c, 'auto')).permissionDecision, 'deny', c);
  }
});

// --- Process entry point (Change 3) ---
//
// Every test above calls decide() in-process. The actual contract Claude
// Code drives is the stdin-to-stdout wrapper guarded by
// `require.main === module`, which had zero coverage until now.

test('the hook process entry point emits a valid decision on stdin', () => {
  const {execFileSync} = require('node:child_process');
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', permission_mode: 'auto',
    tool_input: {command: 'stripe-x refunds create --live --confirm'}
  });
  const out = execFileSync('node', [__dirname + '/../hooks/pretooluse-stripe-guard.js'],
    {input: payload, encoding: 'utf8', env: {PATH: process.env.PATH}});
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
});

test('the hook process entry point defers on malformed stdin', () => {
  const {execFileSync} = require('node:child_process');
  const out = execFileSync('node', [__dirname + '/../hooks/pretooluse-stripe-guard.js'],
    {input: 'not json', encoding: 'utf8', env: {PATH: process.env.PATH}});
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'defer');
});

// --- Vetting token issuance (Changes 1 and 5) ---
//
// The guard now issues a vetting token (src/vetting.js's issue()) whenever
// it recognises a stripe-x invocation and does not deny it, so a `defer`
// or an approved `ask` can still run a live operation, which the engine
// refuses without a token (src/vetting.js, exit 15). These tests exercise
// decide()'s optional second `env` parameter directly, pointing
// CLAUDE_PLUGIN_DATA at a scratch temp directory rather than the real
// plugin data directory, and use isVetted() from src/vetting.js to assert
// on the result. Mirrors the dataDir() helper in test/vetting.test.js.

function dataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hook-guard-vet-'));
}

test('mentionsEngine agrees with the mention gate it mirrors inside decide()', () => {
  assert.equal(mentionsEngine(ev('stripe-x customers list', 'auto')), true);
  assert.equal(mentionsEngine(ev('"STRIPE-X" customers list', 'auto')), true);
  assert.equal(mentionsEngine(ev('ls -la', 'auto')), false);
  assert.equal(mentionsEngine(null), false);
  assert.equal(mentionsEngine({}), false);
  assert.equal(mentionsEngine(ev(123, 'auto')), false);
});

test('a deny decision issues no token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x refunds create --live --confirm', 'auto'), env);
  assert.equal(d.permissionDecision, 'deny');
  assert.equal(isVetted(env), false);
});

test('a defer decision on a simple read issues a token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x customers list --account idd', 'auto'), env);
  assert.equal(d.permissionDecision, 'defer');
  assert.equal(isVetted(env), true);
});

test('an ask decision issues a token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x customers create --account idd --confirm', 'auto'), env);
  assert.equal(d.permissionDecision, 'ask');
  assert.equal(isVetted(env), true);
});

test('a prompting-mode defer issues a token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x refunds create --live --confirm', 'default'), env);
  assert.equal(d.permissionDecision, 'defer');
  assert.equal(isVetted(env), true);
});

test('a command that never mentions the engine issues no token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('ls -la', 'auto'), env);
  assert.equal(d.permissionDecision, 'defer');
  assert.equal(isVetted(env), false);
});

test('issuance is skipped when CLAUDE_PLUGIN_DATA is absent', () => {
  const env = {CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x customers list --account idd', 'auto'), env);
  assert.equal(d.permissionDecision, 'defer');
  assert.equal(isVetted(env), false);
});

test('a failure to write a token does not change or throw past the decision', () => {
  const dir = dataDir();
  // Block issue()'s mkdirSync: a regular file sitting where it needs to
  // create a directory makes the write throw ENOTDIR.
  fs.writeFileSync(path.join(dir, 'stripe-x'), 'not a directory');
  const env = {CLAUDE_PLUGIN_DATA: dir, CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x customers list --account idd', 'auto'), env);
  assert.equal(d.permissionDecision, 'defer');
  assert.equal(isVetted(env), false);
});
