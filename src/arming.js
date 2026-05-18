'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Used only when no CLAUDE_SESSION_ID is provided. Generated once per process
// so it cannot be spoofed by a caller setting CLAUDE_SESSION_ID to a fixed
// sentinel, and so two separate no-session CLI invocations never share arming
// state (the safe under-arm direction).
const EPHEMERAL_SID = 'ephemeral-' + crypto.randomUUID();

// Strip anything that is not a safe filename character so a crafted
// CLAUDE_SESSION_ID (e.g. containing ../) cannot escape the arming directory.
function safeSid(env) {
  const raw = env.CLAUDE_SESSION_ID;
  if (!raw) return EPHEMERAL_SID;
  const cleaned = String(raw).replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : EPHEMERAL_SID;
}

function tokenPath(env) {
  const dir = path.join(env.CLAUDE_PLUGIN_DATA || '.', 'stripe-x', 'arming');
  return {dir: dir, file: path.join(dir, safeSid(env) + '.json')};
}

function readSet(env) {
  const t = tokenPath(env);
  try {
    return new Set(JSON.parse(fs.readFileSync(t.file, 'utf8')).armed || []);
  } catch (e) {
    return new Set();
  }
}

function isArmed(account, env) {
  return readSet(env).has(account);
}

function arm(account, env) {
  const t = tokenPath(env);
  fs.mkdirSync(t.dir, {recursive: true});
  const s = readSet(env);
  s.add(account);
  const tmp = t.file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({armed: Array.from(s)}));
  fs.renameSync(tmp, t.file);
}

module.exports = {isArmed, arm};
