'use strict';
const {resolveSecretRef} = require('./secrets');

function sourceSecret(value, env, opts) {
  const o = opts || {};
  return resolveSecretRef(value, {env: env, opAccount: o.opAccount, opRunner: o.opRunner});
}

function pickKey(acct, live) {
  const k = live ? acct.live_secret_key : acct.test_secret_key;
  if (!k) {
    throw new Error('Account has no ' + (live ? 'live_secret_key' : 'test_secret_key') + ' configured.');
  }
  return k;
}

function resolveAccount(reg, name, opts) {
  const accountName = name || reg.default_account;
  if (!accountName) throw new Error('No account given and no default_account in registry.');
  const acct = reg.accounts[accountName];
  if (!acct) {
    throw new Error('Unknown account "' + accountName + '". Available: ' + Object.keys(reg.accounts).join(', '));
  }
  const mode = opts.live ? 'live' : 'test';
  if (acct.type === 'standalone') {
    return {
      name: accountName, mode,
      apiKey: sourceSecret(pickKey(acct, opts.live), opts.env,
        {opAccount: acct.op_account, opRunner: opts.opRunner}),
      stripeAccount: undefined
    };
  }
  if (acct.type === 'connect') {
    const platform = reg.accounts[acct.platform];
    if (!platform || platform.type !== 'standalone') {
      throw new Error('Connect account "' + accountName + '" references missing or non-standalone platform "' + acct.platform + '".');
    }
    if (!acct.connected_account) {
      throw new Error('Connect account "' + accountName + '" is missing connected_account.');
    }
    return {
      name: accountName, mode,
      // The key belongs to the platform, so the 1Password account selector
      // must come from the platform record, not the connect record.
      apiKey: sourceSecret(pickKey(platform, opts.live), opts.env,
        {opAccount: platform.op_account, opRunner: opts.opRunner}),
      stripeAccount: acct.connected_account
    };
  }
  throw new Error('Account "' + accountName + '" has unknown type "' + acct.type + '".');
}

function expandAccounts(reg, spec) {
  const names = spec === 'all' ? Object.keys(reg.accounts) : String(spec).split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('No account specified.');
  for (const n of names) {
    if (!reg.accounts[n]) {
      throw new Error('Unknown account "' + n + '". Available: ' + Object.keys(reg.accounts).join(', '));
    }
  }
  return names;
}

function isFanOut(names) {
  return names.length > 1;
}

module.exports = {resolveAccount, sourceSecret, expandAccounts, isFanOut};
