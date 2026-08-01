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

// Stripe CLI subcommands that only observe. Everything absent from this list
// classifies as mutating, including subcommands that do not exist yet, so a
// new money-moving subcommand is gated the day it ships rather than the day
// someone notices it.
//
// This is an allowlist for the same reason src/hooks' SIMPLE_CHARS is: the
// alternative, listing the dangerous ones, was wrong eight times in this
// repo's history. `listen` is a read because it forwards events without
// creating any; `trigger` and `fixtures` create objects, so they are not.
// Frozen array - genuinely immutable. Module-private Set for O(1) lookup.
const CLI_READ_SUBCOMMANDS = Object.freeze(['get', 'logs', 'listen', 'resources', 'version', 'config', 'status']);
const _cliRead = new Set(CLI_READ_SUBCOMMANDS);

function classifyCliSub(subcommandName) {
  return _cliRead.has(String(subcommandName || '').toLowerCase()) ? 'read' : 'mutating';
}

function resolveCliBinary(env, version) {
  const dataDir = env.CLAUDE_PLUGIN_DATA || path.join(env.HOME || '.', '.claude', 'plugins', 'data', 'stripe');
  return path.join(dataDir, 'stripe-cli', version, 'stripe');
}

module.exports = {buildCliArgs, blocksTriggerInLive, resolveCliBinary, classifyCliSub, CLI_READ_SUBCOMMANDS};
