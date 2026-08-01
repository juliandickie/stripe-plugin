'use strict';
const {spawnSync} = require('node:child_process');

const OP_PREFIX = 'op://';
const ENV_PREFIX = 'env:';

// Per-process, memory only. A resolved secret is never written to disk.
// Keyed by 1Password account plus reference (as a JSON tuple, so two
// accounts holding the same vault path cannot collide).
const _cache = new Map();

function _resetCache() {
  _cache.clear();
}

function _cacheKey(ref, opAccount) {
  return JSON.stringify([opAccount || '', ref]);
}

function assertRefAcceptable(ref, ctx) {
  const where = 'account "' + ctx.account + '": ' + ctx.field;
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error(where + ' is missing or empty.');
  }
  if (ref.startsWith(OP_PREFIX)) return;
  if (ref.startsWith(ENV_PREFIX)) {
    if (ctx.live) {
      throw new Error(where + ' must be a 1Password reference (op://Vault/Item/field). '
        + 'A live key cannot come from an environment variable.');
    }
    return;
  }
  throw new Error(where + ' must be an op:// or env: reference. '
    + 'Plaintext secrets in the registry are refused.');
}

function _defaultOpRunner(argv, opts) {
  return spawnSync('op', argv, {encoding: 'utf8', timeout: opts.timeout});
}

function _readFromOp(ref, opts) {
  const opAccount = opts.opAccount;
  const key = _cacheKey(ref, opAccount);
  if (_cache.has(key)) return _cache.get(key);

  const runner = opts.opRunner || _defaultOpRunner;
  const env = opts.env || {};
  // A non-numeric override must not reach spawnSync as NaN, which would
  // surface as a raw Node range error instead of this module's messages.
  const parsedTimeout = parseInt(env.CLAUDE_PLUGIN_OPTION_OP_TIMEOUT || '60', 10);
  const seconds = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60;
  const argv = ['read', ref];
  if (opAccount) argv.push('--account', opAccount);

  const r = runner(argv, {timeout: seconds * 1000});

  if (r && r.error) {
    if (r.error.code === 'ENOENT') {
      throw new Error('The 1Password CLI (op) is not installed; '
        + 'brew install 1password-cli, then retry.');
    }
    if (r.error.code === 'ETIMEDOUT') {
      throw new Error('1Password did not respond within ' + seconds + 's; '
        + 'unlock the 1Password app and retry.');
    }
    throw new Error('1Password could not be run: ' + r.error.message);
  }
  if (!r || r.status !== 0) {
    const detail = ((r && r.stderr) || '').trim() || 'op exited non-zero';
    if (/multiple accounts/i.test(detail)) {
      throw new Error('1Password reports multiple accounts. '
        + 'Set "op_account" on this registry entry to select one. Detail: ' + detail);
    }
    throw new Error('1Password could not read ' + ref + ': ' + detail);
  }
  // Only trailing line endings from `op read` are stripped; the secret is
  // otherwise kept byte for byte.
  const secret = String(r.stdout).replace(/[\r\n]+$/, '');
  if (secret.length === 0) {
    throw new Error('1Password returned an empty value for ' + ref + '.');
  }
  _cache.set(key, secret);
  return secret;
}

function resolveSecretRef(ref, opts) {
  const o = opts || {};
  const env = o.env || {};
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error('Missing secret reference in registry.');
  }
  if (ref.startsWith(ENV_PREFIX)) {
    const name = ref.slice(ENV_PREFIX.length);
    const v = env[name];
    if (v == null || v === '') {
      throw new Error('Environment variable ' + name
        + ' is not set or is empty (referenced by registry).');
    }
    return v;
  }
  if (ref.startsWith(OP_PREFIX)) {
    return _readFromOp(ref, o);
  }
  // Deliberately does NOT echo `ref`. Reaching this line means `ref` is
  // neither an op:// nor an env: reference, and the commonest cause is a
  // raw Stripe key pasted into the registry, so `ref` IS the secret. The
  // account and field names from assertRefAcceptable are the actionable
  // detail; the value never is.
  throw new Error('Unsupported secret reference. Use op://Vault/Item/field or env:NAME.');
}

module.exports = {assertRefAcceptable, resolveSecretRef, _resetCache};
