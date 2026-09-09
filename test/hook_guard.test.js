const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {decide, mentionsEngine, parseEngineCommand, vettingKeyFor, VALUE_FLAGS, BOOLEAN_FLAGS} = require('../hooks/pretooluse-stripe-guard');
const {isVetted, canonicalKey} = require('../src/vetting');

function ev(command, permission_mode, overrides) {
  return Object.assign({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    permission_mode: permission_mode, tool_input: {command: command}
  }, overrides || {});
}

test('non-Bash and non-PreToolUse events get no opinion', () => {
  assert.equal(decide(ev('stripe-x refunds create --live', 'auto', {tool_name: 'Read'})).permissionDecision, undefined);
  assert.equal(decide(ev('stripe-x refunds create --live', 'auto', {hook_event_name: 'PostToolUse'})).permissionDecision, undefined);
});

test('commands that do not mention the engine get no opinion', () => {
  assert.equal(decide(ev('ls -la', 'auto')).permissionDecision, undefined);
  assert.equal(decide(ev('git status', 'bypassPermissions')).permissionDecision, undefined);
});

test('prompting modes always get no opinion, even for live', () => {
  for (const m of ['default', 'plan', 'acceptEdits']) {
    assert.equal(decide(ev('stripe-x refunds create --live --confirm', m)).permissionDecision, undefined, m);
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

test('a read gets no opinion even in a non-prompting mode', () => {
  assert.equal(decide(ev('stripe-x customers list --account idd', 'auto')).permissionDecision, undefined);
  assert.equal(decide(ev('stripe-x charges retrieve --id ch_1', 'auto')).permissionDecision, undefined);
});

test('help is read-only and gets no opinion', () => {
  assert.equal(decide(ev('stripe-x help customers', 'auto')).permissionDecision, undefined);
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
  assert.equal(decide(ev('stripe-x --account idd customers list', 'auto')).permissionDecision, undefined);
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
  assert.equal(decide(null).permissionDecision, undefined);
  assert.equal(decide({}).permissionDecision, undefined);
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
  assert.equal(decide(ev('stripe-x customers list --account idd', 'auto')).permissionDecision, undefined);
  assert.equal(decide(ev('stripe-x --account idd customers list', 'auto')).permissionDecision, undefined);
  assert.equal(decide(ev('stripe-x help customers', 'auto')).permissionDecision, undefined);
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
  assert.equal(decide(ev('stripe-x charges retrieve --id ch_1 --expand data', 'auto')).permissionDecision, undefined);
  assert.equal(decide(ev('stripe-x paymentIntents list --limit 5', 'auto')).permissionDecision, undefined);
  assert.equal(decide(ev('stripe-x customers list --account idd --table', 'auto')).permissionDecision, undefined);
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
    assert.equal(decide(ev(c, 'auto')).permissionDecision, undefined, c);
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

test('the hook process entry point emits an empty decision on malformed stdin', () => {
  const {execFileSync} = require('node:child_process');
  const out = execFileSync('node', [__dirname + '/../hooks/pretooluse-stripe-guard.js'],
    {input: 'not json', encoding: 'utf8', env: {PATH: process.env.PATH}});
  // No opinion is emitted as an empty object, never as a decision value.
  // Claude Code 2.1.260 treats the string 'defer' as a real deferral.
  assert.deepEqual(JSON.parse(out), {});
});

// --- Vetting token issuance ---
//
// The guard issues a vetting token (src/vetting.js's issue()) when it parses
// a stripe-x invocation that the engine will gate and does not deny it, so a
// `defer` or an approved `ask` can still run its live operation, which the
// engine refuses without a matching token (src/vetting.js, exit 15).
//
// TWO PROPERTIES CHANGED HERE WHEN THE TOKEN WAS BOUND TO THE CALL, and they
// are the whole point of the change rather than incidental:
//
//   1. A token names ONE operation. It is filed under canonicalKey() and
//      vets nothing else.
//   2. Only operations the engine actually gates mint anything at all. Reads
//      and test-mode calls now issue NOTHING. Under the unbound scheme every
//      recognised call minted a session-wide token, so routine read traffic
//      kept one warm almost continuously and an obfuscated live call could
//      ride it. That was the Critical this replaced.
//
// These tests exercise decide()'s optional second `env` parameter directly,
// pointing CLAUDE_PLUGIN_DATA at a scratch temp directory rather than the
// real plugin data directory, and use isVetted() from src/vetting.js to
// assert on the result. Mirrors the dataDir() helper in test/vetting.test.js.

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

test('mentionsEngine requires the same event and tool _decide requires, even though hooks.json makes this unreachable in production', () => {
  assert.equal(mentionsEngine(ev('stripe-x customers list', 'auto', {tool_name: 'Read'})), false);
  assert.equal(mentionsEngine(ev('stripe-x customers list', 'auto', {hook_event_name: 'PostToolUse'})), false);
});

const LIVE_REFUND = canonicalKey({account: 'idd', resource: 'refunds', action: 'create', live: true});
const LIVE_REFUND_CMD = 'stripe-x refunds create --live --confirm --account idd';

test('a non-Bash event mentioning the engine issues no token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev(LIVE_REFUND_CMD, 'auto', {tool_name: 'Read'}), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, LIVE_REFUND), false);
});

test('a deny decision issues no token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev(LIVE_REFUND_CMD, 'auto'), env);
  assert.equal(d.permissionDecision, 'deny');
  assert.equal(isVetted(env, LIVE_REFUND), false);
});

test('a read issues NO token, so routine traffic cannot keep one warm', () => {
  // The Critical this replaced: under the unbound scheme this call minted a
  // session-wide token, and an obfuscated live call could then ride it.
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x customers list --account idd', 'auto'), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, canonicalKey({account: 'idd', resource: 'customers', action: 'list', live: true})), false);
  assert.equal(isVetted(env, LIVE_REFUND), false);
  assert.equal(fs.readdirSync(env.CLAUDE_PLUGIN_DATA).length, 0, 'nothing written at all');
});

test('a test-mode write issues no token, because the engine never gates one', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x customers create --account idd --confirm', 'auto'), env);
  assert.equal(d.permissionDecision, 'ask');
  assert.equal(isVetted(env, canonicalKey({account: 'idd', resource: 'customers', action: 'create', live: false})), false);
  assert.equal(fs.readdirSync(env.CLAUDE_PLUGIN_DATA).length, 0, 'nothing written at all');
});

test('a prompting-mode defer on a live op issues a token bound to that op', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev(LIVE_REFUND_CMD, 'default'), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, LIVE_REFUND), true);
  // The binding, asserted from the guard's own side: this token authorises
  // that refund and nothing else.
  assert.equal(isVetted(env, canonicalKey({account: 'idd', resource: 'payouts', action: 'create', live: true})), false);
  assert.equal(isVetted(env, canonicalKey({account: 'promktg', resource: 'refunds', action: 'create', live: true})), false);
  assert.equal(isVetted(env, canonicalKey({account: 'idd', resource: 'refunds', action: 'create', live: true, arm: true})), false);
});

test('a prompting-mode defer on a live arm issues an arm token only', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('stripe-x refunds create --live --arm-live --account idd', 'default'), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, canonicalKey({account: 'idd', resource: 'refunds', action: 'create', live: true, arm: true})), true);
  assert.equal(isVetted(env, LIVE_REFUND), false, 'arming a live op must not authorise executing it');
});

test('a runtime-assembled invocation mints nothing, so the engine has nothing to find', () => {
  // The guard cannot recognise this and never could; no text classifier can.
  // The defence is that it therefore issues no token, not that it spots it.
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  decide(ev('A=stri; B=pe-x; $A$B refunds create --live --confirm --account idd', 'default'), env);
  assert.equal(isVetted(env, LIVE_REFUND), false);
  assert.equal(fs.readdirSync(env.CLAUDE_PLUGIN_DATA).length, 0);
});

test('a live op the guard cannot prove simple mints nothing', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  decide(ev('stripe-x refunds create --li"ve" --confirm --account idd', 'default'), env);
  assert.equal(isVetted(env, LIVE_REFUND), false);
});

test('a command that never mentions the engine issues no token', () => {
  const env = {CLAUDE_PLUGIN_DATA: dataDir(), CLAUDE_SESSION_ID: 's'};
  const d = decide(ev('ls -la', 'auto'), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, LIVE_REFUND), false);
});

test('issuance is skipped when CLAUDE_PLUGIN_DATA is absent', () => {
  const env = {CLAUDE_SESSION_ID: 's'};
  const d = decide(ev(LIVE_REFUND_CMD, 'default'), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, LIVE_REFUND), false);
});

test('a failure to write a token does not change or throw past the decision', () => {
  const dir = dataDir();
  // Block issue()'s mkdirSync: a regular file sitting where it needs to
  // create a directory makes the write throw ENOTDIR. Uses a live op so the
  // write is genuinely attempted.
  fs.writeFileSync(path.join(dir, 'stripe-x'), 'not a directory');
  const env = {CLAUDE_PLUGIN_DATA: dir, CLAUDE_SESSION_ID: 's'};
  const d = decide(ev(LIVE_REFUND_CMD, 'default'), env);
  assert.equal(d.permissionDecision, undefined);
  assert.equal(isVetted(env, LIVE_REFUND), false);
});

// --- The key parse itself ---

test('vettingKeyFor names exactly the operation the engine will compute', () => {
  assert.equal(vettingKeyFor(ev(LIVE_REFUND_CMD, 'default')), LIVE_REFUND);
  assert.equal(
    vettingKeyFor(ev('stripe-x cli post /v1/refunds --live --account idd', 'default')),
    canonicalKey({account: 'idd', resource: 'cli', action: 'post', live: true}));
});

test('vettingKeyFor returns null for anything the engine will not gate', () => {
  assert.equal(vettingKeyFor(ev('stripe-x customers list --account idd --live', 'default')), null, 'live read');
  assert.equal(vettingKeyFor(ev('stripe-x customers create --account idd', 'default')), null, 'test-mode write');
  assert.equal(vettingKeyFor(ev('stripe-x cli logs --live --account idd', 'default')), null, 'live CLI read');
  assert.equal(vettingKeyFor(ev('stripe-x help refunds', 'default')), null, 'help');
  assert.equal(vettingKeyFor(ev('ls -la', 'default')), null, 'unrelated command');
});

test('parseEngineCommand refuses to name anything it cannot read with certainty', () => {
  assert.equal(parseEngineCommand('stripe-x refunds create --li"ve" --account idd'), null, 'quoting');
  assert.equal(parseEngineCommand('A=stri; B=pe-x; $A$B refunds create --live'), null, 'runtime assembly');
  assert.equal(parseEngineCommand('stripe-x refunds list | stripe-x refunds create --live'), null, 'two invocations');
  assert.equal(parseEngineCommand('stripe-x refunds create --live --unknown-flag'), null, 'unrecognised flag');
  assert.equal(parseEngineCommand('stripe-x refunds --account'), null, 'value flag with no value');
  assert.equal(parseEngineCommand('stripe-x refunds'), null, 'no action');
});

test('vet and help never mint a key, even carrying --arm-live', () => {
  // `stripe-x vet ... --arm-live` must not mint a token keyed on the literal
  // resource "vet", which names no real operation.
  assert.equal(vettingKeyFor(ev('stripe-x vet refunds create --live --arm-live --account idd', 'default')), null);
  assert.equal(vettingKeyFor(ev('stripe-x vet refunds create --live --account idd', 'default')), null);
  assert.equal(vettingKeyFor(ev('stripe-x help refunds --live --arm-live', 'default')), null);
});

test('the target is part of the key', () => {
  const one = vettingKeyFor(ev('stripe-x customers del --id cus_1 --live --confirm --account idd', 'default'));
  const two = vettingKeyFor(ev('stripe-x customers del --id cus_999 --live --confirm --account idd', 'default'));
  assert.notEqual(one, two);
  assert.equal(one, canonicalKey({account: 'idd', resource: 'customers', action: 'del', live: true, id: 'cus_1'}));
});

test('bulk targets are order-insensitive but membership-sensitive', () => {
  const a = vettingKeyFor(ev('stripe-x customers del --bulk-ids cus_2,cus_1 --live --confirm --account idd', 'default'));
  const b = vettingKeyFor(ev('stripe-x customers del --bulk-ids cus_1,cus_2 --live --confirm --account idd', 'default'));
  const c = vettingKeyFor(ev('stripe-x customers del --bulk-ids cus_1,cus_3 --live --confirm --account idd', 'default'));
  assert.equal(a, b, 'the same set in a different order is the same operation');
  assert.notEqual(a, c, 'a different set is a different operation');
});

// --- Divergence between this parse and src/cli.js parseArgs ---
//
// A divergence that makes the guard STRICTER than the engine costs a false
// refusal. One that makes it looser would authorise an operation no gate
// classified. These pin the cases where the two could plausibly disagree.

test('a value that looks like a flag is swallowed by both parsers alike', () => {
  // parseArgs takes the next token blindly, so --live here is --account's
  // VALUE and the call is not live. This parse must agree, or it would name
  // a live operation the engine will not run (or vice versa).
  const p = parseEngineCommand('stripe-x customers list --account --live');
  assert.equal(p.account, '--live');
  assert.equal(p.live, false);
});

test('an end-of-options marker is refused rather than guessed at', () => {
  // parseArgs has no `--` handling and would push it into the resource slot.
  // Refusing is the fail-closed side of that disagreement.
  assert.equal(parseEngineCommand('stripe-x -- customers list'), null);
});

test('a repeated flag resolves last-wins on both sides', () => {
  const p = parseEngineCommand('stripe-x customers del --account a --account b --id x --id y --live');
  assert.equal(p.account, 'b');
  assert.equal(p.id, 'y');
});

test('parseEngineCommand captures the account and registry as written', () => {
  const p = parseEngineCommand('stripe-x refunds create --live --account idd --accounts-file /tmp/a.json');
  assert.equal(p.account, 'idd');
  assert.equal(p.accountsFile, '/tmp/a.json');
  assert.equal(p.live, true);
  assert.equal(p.arm, false);
  assert.equal(p.resource, 'refunds');
  assert.equal(p.action, 'create');
});
