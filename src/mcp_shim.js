'use strict';
const {run} = require('./cli');

function shouldRun(env) {
  return env.CLAUDE_PLUGIN_OPTION_ENABLE_MCP_SHIM === 'true';
}

function listTools() {
  return [
    {name: 'stripe_call', description: 'Call any Stripe endpoint via the engine. Args mirror the stripe-x CLI grammar; the binary still enforces confirmation, arming, and fan-out rules.',
      inputSchema: {type: 'object', required: ['resource', 'action'], properties: {
        resource: {type: 'string'}, action: {type: 'string'}, account: {type: 'string'},
        live: {type: 'boolean'}, id: {type: 'string'}, params: {type: 'object'},
        expand: {type: 'array', items: {type: 'string'}}, all: {type: 'boolean'},
        confirm: {type: 'boolean'}, confirm_bulk: {type: 'boolean'}, arm_live: {type: 'boolean'},
        limit: {type: 'number'}, api_version: {type: 'string'}, idempotency_key: {type: 'string'},
        bulk_ids: {type: 'array', items: {type: 'string'}}, table: {type: 'boolean'},
        accounts_file: {type: 'string'}}}},
    {name: 'stripe_accounts', description: 'List configured accounts (names, labels, types, modes). Never returns secrets.',
      inputSchema: {type: 'object', properties: {}}}
  ];
}

function toArgv(input) {
  const a = [input.resource, input.action];
  if (input.account) a.push('--account', input.account);
  if (input.live) a.push('--live');
  if (input.id) a.push('--id', input.id);
  if (input.params) a.push('--params', JSON.stringify(input.params));
  if (input.expand) a.push('--expand', input.expand.join(','));
  if (input.all) a.push('--all');
  if (input.confirm) a.push('--confirm');
  if (input.confirm_bulk) a.push('--confirm-bulk');
  if (input.arm_live) a.push('--arm-live');
  if (input.limit != null) a.push('--limit', String(input.limit));
  if (input.api_version) a.push('--api-version', input.api_version);
  if (input.idempotency_key) a.push('--idempotency-key', input.idempotency_key);
  if (input.bulk_ids && input.bulk_ids.length) a.push('--bulk-ids', input.bulk_ids.join(','));
  if (input.table) a.push('--table');
  if (input.accounts_file) a.push('--accounts-file', input.accounts_file);
  return a;
}

function listAccounts(env) {
  const {resolveRegistryPath, loadRegistry} = require('./registry');
  let reg;
  try { reg = loadRegistry(resolveRegistryPath({}, env || {})); }
  catch (e) { return {error: e.message}; }
  const out = {default_account: reg.default_account, accounts: {}};
  for (const [name, a] of Object.entries(reg.accounts)) {
    out.accounts[name] = a.type === 'connect'
      ? {type: 'connect', label: a.label, platform: a.platform, connected_account: a.connected_account}
      : {type: 'standalone', label: a.label, has_test_key: !!a.test_secret_key, has_live_key: !!a.live_secret_key};
  }
  return out;
}

async function handleCall(input, ctx) {
  return run(toArgv(input), ctx || {});
}

module.exports = {shouldRun, listTools, toArgv, handleCall, listAccounts};
