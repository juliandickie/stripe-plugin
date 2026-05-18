'use strict';
const fs = require('node:fs');
const path = require('node:path');

function resolveRegistryPath(opts, env) {
  if (opts && opts.flag) return opts.flag;
  if (env.STRIPE_X_ACCOUNTS_FILE) return env.STRIPE_X_ACCOUNTS_FILE;
  if (env.CLAUDE_PLUGIN_OPTION_ACCOUNTS_FILE) return env.CLAUDE_PLUGIN_OPTION_ACCOUNTS_FILE;
  const dataDir = env.CLAUDE_PLUGIN_DATA || path.join(env.HOME || '.', '.claude');
  return path.join(dataDir, 'stripe-x', 'accounts.json');
}

function loadRegistry(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      throw new Error('Accounts registry not found at ' + p + '. Run /stripe:stripe-setup.');
    }
    throw new Error('Cannot read accounts registry at ' + p + ': ' + e.message);
  }
  let reg;
  try {
    reg = JSON.parse(raw);
  } catch (e) {
    throw new Error('Accounts registry at ' + p + ' is not valid JSON: ' + e.message);
  }
  if (!reg || typeof reg.accounts !== 'object' || reg.accounts === null || Array.isArray(reg.accounts)) {
    throw new Error('Accounts registry must contain an "accounts" object.');
  }
  return reg;
}

module.exports = {resolveRegistryPath, loadRegistry};
