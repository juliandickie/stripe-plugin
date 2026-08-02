'use strict';
const Stripe = require('stripe');
const {resolveRegistryPath, loadRegistry} = require('./registry');
const {resolveAccount, expandAccounts, isFanOut} = require('./resolver');
const {classify} = require('./classify');
const {isArmed, arm} = require('./arming');
const {issue: issueVet, isVetted, canonicalKey, ttlSeconds} = require('./vetting');
const {needsScopeReview, scopeReview} = require('./bulk');
const {camelizePath, resolveMethod, callStripe} = require('./dispatch');
const {mapStripeError, aggregate} = require('./errors');

const EXIT = {OK: 0, ERROR: 1, USAGE: 2, CONFIRM: 10, BULK: 11, ARM: 12, FANOUT: 13, ARMED: 14, UNVETTED: 15};

function parseArgs(argv) {
  const a = {data: {}, expand: [], _: []};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--account') a.account = argv[++i];
    else if (t === '--id') a.id = argv[++i];
    else if (t === '--params') a.params = JSON.parse(argv[++i]);
    else if (t === '--data') { const kv = argv[++i]; const ix = kv.indexOf('='); if (ix < 0) throw new Error('--data requires key=value form, got: ' + kv); a.data[kv.slice(0, ix)] = kv.slice(ix + 1); }
    else if (t === '--expand') a.expand = argv[++i].split(',');
    else if (t === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (t === '--all') a.all = true;
    else if (t === '--idempotency-key') a.idempotencyKey = argv[++i];
    else if (t === '--api-version') a.apiVersion = argv[++i];
    else if (t === '--live') a.live = true;
    else if (t === '--confirm') a.confirm = true;
    else if (t === '--confirm-bulk') a.confirmBulk = true;
    else if (t === '--arm-live') a.armLive = true;
    else if (t === '--bulk-ids') a.bulkIds = argv[++i].split(',').map((x) => x.trim()).filter(Boolean);
    else if (t === '--accounts-file') a.accountsFile = argv[++i];
    else if (t === '--table') a.table = true;
    else a._.push(t);
  }
  a.resource = a._[0];
  a.action = a._[1];
  return a;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function buildParams(a) {
  if (a.params) return a.params;
  const out = {};
  for (const k of Object.keys(a.data)) {
    const v = a.data[k];
    const m = k.match(/^([^\[]+)\[([^\]]+)\]$/);
    if (m) {
      if (DANGEROUS_KEYS.has(m[1]) || DANGEROUS_KEYS.has(m[2])) continue;
      if (!Object.prototype.hasOwnProperty.call(out, m[1])) out[m[1]] = {};
      out[m[1]][m[2]] = v;
    } else {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = v;
    }
  }
  return out;
}

async function run(argv, ctx) {
  const env = (ctx && ctx.env) || process.env;
  const stripeFactory = (ctx && ctx.stripeFactory) ||
    ((cfg) => new Stripe(cfg.apiKey, cfg.apiVersion ? {apiVersion: cfg.apiVersion} : {}));
  // Mirrors stripeFactory just above: undefined in production (resolveAccount
  // then uses the real `op` binary); tests inject a stub here instead.
  const opRunner = ctx && ctx.opRunner;
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    return {exitCode: EXIT.USAGE, stdout: 'Usage error: ' + e.message};
  }
  if (a.resource === 'help') {
    const fs = require('node:fs');
    const path = require('node:path');
    const {camelizePath} = require('./dispatch');
    let apiMap = {};
    try {
      apiMap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'stripe-api-map.json'), 'utf8'));
    } catch (e) {
      return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: {message: 'api-map not found: ' + e.message}})};
    }
    const query = a.action;
    if (!query) {
      return {exitCode: EXIT.OK, stdout: 'Usage: stripe-x <resource.path> <action> [flags]\nDiscover operations: stripe-x help <resource.path>  (example: stripe-x help customers)'};
    }
    const camel = camelizePath(query);
    const matches = Object.keys(apiMap).filter((k) => k === camel || k.indexOf(camel + '.') === 0 || apiMap[k].resource === camel).sort();
    if (matches.length === 0) {
      const head = camel.split('.')[0];
      const near = Object.keys(apiMap).filter((k) => k.indexOf(head) === 0).slice(0, 12);
      return {exitCode: EXIT.OK, stdout: 'No operations found for "' + query + '". Nearby: ' + (near.join(', ') || '(none)')};
    }
    return {exitCode: EXIT.OK, stdout: 'Operations for "' + query + '":\n' + matches.map((k) => k + '  [' + apiMap[k].httpMethod + ']').join('\n')};
  }
  if (a.resource === 'cli') {
    return await runCliBridge(a, env, ctx);
  }
  if (a.resource === 'vet') {
    // Requires a controlling terminal. Claude Code's Bash tool has no TTY,
    // so an agent cannot mint a token this way; a human at a terminal can.
    // That distinction is what stops this escape hatch being available to
    // the very caller the vetting token exists to constrain. It is a
    // presence heuristic and not proof of a human: `script`, `expect` and
    // Python's pty all defeat it.
    const tty = (ctx && ctx.isTTY !== undefined) ? ctx.isTTY : !!process.stdin.isTTY;
    if (!tty) {
      return {exitCode: EXIT.USAGE,
        stdout: 'REFUSED: `stripe-x vet` must be run interactively from a terminal. '
          + 'Inside Claude Code, the permission guard issues vetting automatically.'};
    }
    // Vetting names the one operation it authorises. A blanket session token
    // would defeat the point: it would prove only that a human vetted
    // something recently, which is the unbound behaviour this replaced.
    const vetResource = a._[1];
    const vetAction = a._[2];
    if (!vetResource || !vetAction) {
      return {exitCode: EXIT.USAGE,
        stdout: 'Usage: stripe-x vet <resource.path> <action> --live [--arm-live] [--account <name>]\n'
          + 'Vetting authorises exactly one operation. A token for "customers list" never '
          + 'authorises "refunds create".'};
    }
    if (!a.live) {
      return {exitCode: EXIT.USAGE,
        stdout: 'Usage error: stripe-x vet requires --live (vetting gates live operations only).'};
    }
    const vetKey = canonicalKey({account: a.account || '', accountsFile: a.accountsFile || '',
      resource: vetResource, action: vetAction, live: true, arm: !!a.armLive,
      id: a.id, bulkIds: a.bulkIds});
    issueVet(env, vetKey);
    return {exitCode: EXIT.OK,
      stdout: 'VETTED: ' + (a.armLive ? 'arming of' : 'execution of') + ' "' + vetResource + '.'
        + vetAction + '" in LIVE mode on account "' + (a.account || '(default)') + '" is '
        + 'authorised for the next ' + ttlSeconds(env) + ' seconds. This token authorises that '
        + 'operation only.'};
  }
  if (!a.resource || !a.action) {
    return {exitCode: EXIT.USAGE, stdout: 'Usage: stripe-x <resource.path> <action> [flags]'};
  }
  let reg;
  try {
    reg = loadRegistry(resolveRegistryPath({flag: a.accountsFile}, env));
  } catch (e) {
    return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: {message: e.message}})};
  }

  const segment = camelizePath(a.resource).split('.').pop();
  const cls = classify(segment, a.action);
  let names;
  try {
    names = expandAccounts(reg, a.account || reg.default_account);
  } catch (e) {
    return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: {message: e.message}})};
  }

  // Arming is its own invocation. It never executes, even with --confirm,
  // so live execution always costs two separate tool calls and therefore
  // two separate permission prompts. Resolved before the fan-out refusal
  // and before the read/write split, so --arm-live always lands here and
  // reports what it did, instead of being silently ignored on a read or
  // masked by the fan-out refusal on a write.
  if (a.armLive) {
    if (!a.live) {
      return {exitCode: EXIT.USAGE,
        stdout: 'Usage error: --arm-live requires --live (arming only affects live mode).'};
    }
    if (isFanOut(names)) {
      return {exitCode: EXIT.USAGE,
        stdout: 'Usage error: --arm-live requires a single --account.'};
    }
    // Arming is gated in its own right. Without this an obfuscated
    // `--arm-live` slips underneath the whole scheme: it would arm the
    // account without any gate having seen it, leaving only the execution
    // step to defeat. The arm key differs from the execution key, so
    // approving an arm never silently approves the execution that follows.
    const armKey = canonicalKey({account: a.account || '', accountsFile: a.accountsFile || '',
      resource: a.resource, action: a.action, live: true, arm: true,
      id: a.id, bulkIds: a.bulkIds});
    if (!isVetted(env, armKey)) {
      return {exitCode: EXIT.UNVETTED,
        stdout: 'REFUSED: this arming request carries no vetting token for "' + a.resource + '.'
          + a.action + '", so no permission gate saw it. Inside Claude Code the guard issues '
          + 'vetting automatically; from a terminal run `stripe-x vet ' + a.resource + ' '
          + a.action + ' --live --arm-live` first.'};
    }
    // Deliberately does not resolve the secret: arming is a local act and
    // resolving here would cost a second 1Password approval per operation.
    arm(names[0], env);
    return {exitCode: EXIT.ARMED,
      stdout: 'ARMED: live mode armed for "' + names[0] + '" for this session. '
        + 'Re-run with --live --confirm to execute.'};
  }

  if (isFanOut(names) && cls !== 'read') {
    return {exitCode: EXIT.FANOUT, stdout: 'REFUSED: multi-account fan-out refuses ' + cls + ' actions. Use a single --account for writes.'};
  }

  const params = buildParams(a);
  const req = {id: a.id, params: params, expand: a.expand, all: a.all, limit: a.limit,
    options: a.idempotencyKey ? {idempotencyKey: a.idempotencyKey} : {}};

  if (!isFanOut(names) && cls !== 'read') {
    // The account name and mode are both known from the registry and the
    // --live flag alone - names[0] is already validated by expandAccounts
    // above, and mode is a pure function of --live. Neither needs the
    // secret, so resolveAccount (and the `op read` / biometric prompt a
    // live key costs) is deliberately deferred past every check below that
    // can refuse or preview without it. It is called once, below, only on
    // the path that actually constructs a Stripe client.
    const accountName = names[0];
    const mode = a.live ? 'live' : 'test';
    if (a.live && (cls === 'mutating' || cls === 'destructive')) {
      if (!isArmed(accountName, env)) {
        return {exitCode: EXIT.ARM, stdout: 'REFUSED: live mode not armed for "' + accountName + '". Re-run with --arm-live to arm this session.'};
      }
      // Bound to THIS operation. A token minted for an unrelated read, or
      // for a different account, resource, action or mode, produces a
      // different key and does not satisfy this check.
      const execKey = canonicalKey({account: a.account || '', accountsFile: a.accountsFile || '',
        resource: a.resource, action: a.action, live: true, arm: false,
        id: a.id, bulkIds: a.bulkIds});
      if (!isVetted(env, execKey)) {
        return {exitCode: EXIT.UNVETTED,
          stdout: 'REFUSED: this live operation carries no vetting token for "' + a.resource + '.'
            + a.action + '", so no permission gate saw it. Inside Claude Code the guard issues '
            + 'vetting automatically; from a terminal run `stripe-x vet ' + a.resource + ' '
            + a.action + ' --live` first.'};
      }
    }
    if (a.bulkIds && a.bulkIds.length) {
      if (a.action === 'create' || /^create[A-Z]/.test(a.action)) {
        return {exitCode: EXIT.USAGE, stdout: 'REFUSED: --bulk-ids cannot be combined with a create action (bulk-ids operates on existing object ids). Use a single create, or a per-id instance action (del/cancel/update/capture).'};
      }
      const threshold = parseInt(env.CLAUDE_PLUGIN_OPTION_BULK_THRESHOLD || '10', 10);
      if (needsScopeReview(a.bulkIds.length, threshold) && !a.confirmBulk) {
        return {exitCode: EXIT.BULK, stdout: JSON.stringify(scopeReview(segment, a.action, a.bulkIds), null, 2)};
      }
    }
    const isBulk = !!(a.bulkIds && a.bulkIds.length);
    if (!a.confirm) {
      const preview = 'CONFIRMATION REQUIRED\n'
        + 'account: ' + accountName + '\nmode: ' + mode.toUpperCase() + '\n'
        + 'operation: ' + a.resource + '.' + a.action + '\nclass: ' + cls + '\n'
        + (isBulk
          ? 'bulk: ' + a.bulkIds.length + ' targets\ntargets: ' + a.bulkIds.join(',') + '\n'
          : 'target id: ' + (a.id ? a.id : '(none)') + '\n')
        + 'params: ' + JSON.stringify(params) + '\n'
        + (cls === 'destructive' ? 'IRREVERSIBLE: this operation cannot be undone.\n' : '')
        + 'Re-run with --confirm to execute.';
      return {exitCode: EXIT.CONFIRM, stdout: preview};
    }
    // Every refusal and the preview above return before this line, so the
    // secret is resolved only once execution is actually about to happen.
    const d = resolveAccount(reg, accountName, {live: !!a.live, env: env, opRunner: opRunner});
    if (isBulk) {
      const client = stripeFactory({apiKey: d.apiKey, apiVersion: a.apiVersion});
      if (d.stripeAccount) req.options.stripeAccount = d.stripeAccount;
      const results = [];
      for (const bid of a.bulkIds) {
        try {
          const r2 = Object.assign({}, req, {id: bid, options: Object.assign({}, req.options)});
          const data = await callStripe(client, a.resource, a.action, r2);
          results.push({account: bid, ok: true, data: data});
        } catch (e) {
          results.push({account: bid, ok: false, error: mapStripeError(e)});
        }
      }
      const agg = aggregate(results);
      return {exitCode: agg.ok ? EXIT.OK : EXIT.ERROR, stdout: JSON.stringify(agg, null, 2)};
    }
    try {
      const client = stripeFactory({apiKey: d.apiKey, apiVersion: a.apiVersion});
      if (d.stripeAccount) req.options.stripeAccount = d.stripeAccount;
      const data = await callStripe(client, a.resource, a.action, req);
      return {exitCode: EXIT.OK, stdout: JSON.stringify(data, null, a.table ? 0 : 2)};
    } catch (e) {
      return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: mapStripeError(e)})};
    }
  }

  const results = [];
  for (const n of names) {
    try {
      const d = resolveAccount(reg, n, {live: !!a.live, env: env, opRunner: opRunner});
      const client = stripeFactory({apiKey: d.apiKey, apiVersion: a.apiVersion});
      const r2 = Object.assign({}, req, {options: Object.assign({}, req.options)});
      if (d.stripeAccount) r2.options.stripeAccount = d.stripeAccount;
      const data = await callStripe(client, a.resource, a.action, r2);
      results.push({account: n, ok: true, data: data});
    } catch (e) {
      results.push({account: n, ok: false, error: mapStripeError(e)});
    }
  }
  if (!isFanOut(names)) {
    const only = results[0];
    if (only.ok) return {exitCode: EXIT.OK, stdout: JSON.stringify(only.data, null, 2)};
    return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: only.error})};
  }
  const agg = aggregate(results);
  return {exitCode: agg.ok ? EXIT.OK : EXIT.ERROR, stdout: JSON.stringify(agg, null, 2)};
}

// The bundled Stripe CLI is a general-purpose client: `cli post /v1/refunds`
// moves real money. Until this was gated it returned before classification,
// arming and vetting were ever reached, and the only live restriction was a
// block on the single literal subcommand `trigger` - while still resolving
// the live key and handing it over.
//
// It now carries the SAME gates as the engine's own dispatch path, in the
// same order (ARM 12 -> VETTED 15 -> CONFIRM 10), rather than a lighter set
// of its own. A separate, more permissive rule set for the bridge is exactly
// the kind of exception list that produced eight of this repo's bypasses.
async function runCliBridge(a, env, ctx) {
  const {resolveRegistryPath, loadRegistry} = require('./registry');
  const {resolveAccount} = require('./resolver');
  const {buildCliArgs, blocksTriggerInLive, resolveCliBinary, classifyCliSub} = require('./cli_bridge');
  const fs = require('node:fs');
  const path = require('node:path');

  let reg;
  try {
    reg = loadRegistry(resolveRegistryPath({flag: a.accountsFile}, env));
  } catch (e) {
    return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: {message: e.message}})};
  }

  const cliArgs = a._.slice(1);
  if (cliArgs.length === 0) {
    return {exitCode: EXIT.USAGE, stdout: 'Usage: stripe-x cli <stripe-cli-subcommand> [args] --account <name> [--live]'};
  }

  const sub = cliArgs[0];
  const mode = a.live ? 'live' : 'test';
  if (blocksTriggerInLive(sub, mode)) {
    return {exitCode: EXIT.ERROR, stdout: 'REFUSED: "stripe ' + sub + '" is blocked in live mode (test-mode events only). Re-run without --live.'};
  }

  // Known from the registry and the --live flag alone. Every refusal and the
  // preview below returns before resolveAccount, so a refused or previewed
  // bridge call costs no 1Password read, matching run()'s behaviour.
  const accountName = a.account || reg.default_account;
  const cls = classifyCliSub(sub);

  if (a.armLive) {
    if (!a.live) {
      return {exitCode: EXIT.USAGE,
        stdout: 'Usage error: --arm-live requires --live (arming only affects live mode).'};
    }
    const bridgeArmKey = canonicalKey({account: a.account || '', accountsFile: a.accountsFile || '',
      resource: 'cli', action: sub, live: true, arm: true, id: a.id, bulkIds: a.bulkIds});
    if (!isVetted(env, bridgeArmKey)) {
      return {exitCode: EXIT.UNVETTED,
        stdout: 'REFUSED: this arming request carries no vetting token for "cli ' + sub + '", so '
          + 'no permission gate saw it. Inside Claude Code the guard issues vetting '
          + 'automatically; from a terminal run `stripe-x vet cli ' + sub + ' --live --arm-live` first.'};
    }
    arm(accountName, env);
    return {exitCode: EXIT.ARMED,
      stdout: 'ARMED: live mode armed for "' + accountName + '" for this session. '
        + 'Re-run with --live --confirm to execute.'};
  }

  if (cls !== 'read') {
    if (a.live) {
      if (!isArmed(accountName, env)) {
        return {exitCode: EXIT.ARM,
          stdout: 'REFUSED: live mode not armed for "' + accountName + '". Re-run with --arm-live to arm this session.'};
      }
      const bridgeKey = canonicalKey({account: a.account || '', accountsFile: a.accountsFile || '',
        resource: 'cli', action: sub, live: true, arm: false, id: a.id, bulkIds: a.bulkIds});
      if (!isVetted(env, bridgeKey)) {
        return {exitCode: EXIT.UNVETTED,
          stdout: 'REFUSED: this live Stripe CLI call carries no vetting token for "cli ' + sub
            + '", so no permission gate saw it. Inside Claude Code the guard issues vetting '
            + 'automatically; from a terminal run `stripe-x vet cli ' + sub + ' --live` first.'};
      }
    }
    if (!a.confirm) {
      return {exitCode: EXIT.CONFIRM,
        stdout: 'CONFIRMATION REQUIRED\n'
          + 'account: ' + accountName + '\nmode: ' + mode.toUpperCase() + '\n'
          + 'operation: stripe CLI "' + cliArgs.join(' ') + '"\nclass: ' + cls + '\n'
          + 'The bundled Stripe CLI receives a resolved API key for this account and its '
          + 'surface is not modelled by this engine.\n'
          + 'Re-run with --confirm to execute.'};
    }
  }

  let version;
  try {
    version = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stripe-cli-version.txt'), 'utf8').trim();
  } catch (e) {
    return {exitCode: EXIT.ERROR, stdout: 'Stripe CLI version pin missing'};
  }

  const bin = resolveCliBinary(env, version);
  if (!fs.existsSync(bin)) {
    return {exitCode: EXIT.ERROR, stdout: 'Stripe CLI not provisioned at ' + bin + '. Run /stripe:stripe-setup (or let the SessionStart hook provision it).'};
  }

  // Last act before spawning, so nothing above this line costs a secret read.
  let d;
  try {
    d = resolveAccount(reg, accountName, {live: !!a.live, env: env, opRunner: ctx && ctx.opRunner});
  } catch (e) {
    return {exitCode: EXIT.ERROR, stdout: JSON.stringify({error: {message: e.message}})};
  }

  const args = buildCliArgs(cliArgs, {apiKey: d.apiKey, stripeAccount: d.stripeAccount});
  const spawn = (ctx && ctx.cliSpawn) || require('node:child_process').spawnSync;
  const r = spawn(bin, args, {stdio: 'inherit'});
  return {exitCode: (r && typeof r.status === 'number') ? r.status : 1, stdout: ''};
}

module.exports = {run, parseArgs, buildParams, EXIT};
