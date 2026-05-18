'use strict';
const path = require('node:path');

function buildCliArgs(subcommand, resolved) {
  const args = subcommand.slice();
  args.push('--api-key', resolved.apiKey);
  if (resolved.stripeAccount) args.push('--stripe-account', resolved.stripeAccount);
  return args;
}

function blocksTriggerInLive(subcommandName, mode) {
  return subcommandName === 'trigger' && mode === 'live';
}

function resolveCliBinary(env, version) {
  const dataDir = env.CLAUDE_PLUGIN_DATA || path.join(env.HOME || '.', '.claude', 'plugins', 'data', 'stripe');
  return path.join(dataDir, 'stripe-cli', version, 'stripe');
}

module.exports = {buildCliArgs, blocksTriggerInLive, resolveCliBinary};
