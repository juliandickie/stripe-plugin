'use strict';
const Stripe = require('stripe');
const {resolveRegistryPath, loadRegistry} = require('./registry');
const {resolveAccount, expandAccounts, isFanOut} = require('./resolver');
const {classify} = require('./classify');
const {isArmed, arm} = require('./arming');
const {needsScopeReview, scopeReview} = require('./bulk');
const {camelizePath, resolveMethod, callStripe} = require('./dispatch');
const {mapStripeError, aggregate} = require('./errors');

const EXIT = {OK: 0, ERROR: 1, USAGE: 2, CONFIRM: 10, BULK: 11, ARM: 12, FANOUT: 13};

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

  if (isFanOut(names) && cls !== 'read') {
    return {exitCode: EXIT.FANOUT, stdout: 'REFUSED: multi-account fan-out refuses ' + cls + ' actions. Use a single --account for writes.'};
  }

  const params = buildParams(a);
  const req = {id: a.id, params: params, expand: a.expand, all: a.all, limit: a.limit,
    options: a.idempotencyKey ? {idempotencyKey: a.idempotencyKey} : {}};

  if (!isFanOut(names) && cls !== 'read') {
    const d = resolveAccount(reg, names[0], {live: !!a.live, env: env});
    if (a.live && (cls === 'mutating' || cls === 'destructive')) {
      if (a.armLive) arm(d.name, env);
      if (!isArmed(d.name, env)) {
        return {exitCode: EXIT.ARM, stdout: 'REFUSED: live mode not armed for "' + d.name + '". Re-run with --arm-live to arm this session.'};
      }
    }
    if (a.bulkIds && a.bulkIds.length) {
      const threshold = parseInt(env.CLAUDE_PLUGIN_OPTION_BULK_THRESHOLD || '10', 10);
      if (needsScopeReview(a.bulkIds.length, threshold) && !a.confirmBulk) {
        return {exitCode: EXIT.BULK, stdout: JSON.stringify(scopeReview(segment, a.action, a.bulkIds), null, 2)};
      }
    }
    const isBulk = !!(a.bulkIds && a.bulkIds.length);
    if (!a.confirm) {
      const preview = 'CONFIRMATION REQUIRED\n'
        + 'account: ' + d.name + '\nmode: ' + d.mode.toUpperCase() + '\n'
        + 'operation: ' + a.resource + '.' + a.action + '\nclass: ' + cls + '\n'
        + (isBulk
          ? 'bulk: ' + a.bulkIds.length + ' targets\ntargets: ' + a.bulkIds.join(',') + '\n'
          : 'target id: ' + (a.id ? a.id : '(none)') + '\n')
        + 'params: ' + JSON.stringify(params) + '\n'
        + (cls === 'destructive' ? 'IRREVERSIBLE: this operation cannot be undone.\n' : '')
        + 'Re-run with --confirm to execute.';
      return {exitCode: EXIT.CONFIRM, stdout: preview};
    }
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
      const d = resolveAccount(reg, n, {live: !!a.live, env: env});
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

module.exports = {run, parseArgs, buildParams, EXIT};
