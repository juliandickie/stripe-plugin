'use strict';
const fs = require('node:fs');
const path = require('node:path');

function tokenPath(env) {
  const dir = path.join(env.CLAUDE_PLUGIN_DATA || '.', 'stripe-x', 'arming');
  const sid = env.CLAUDE_SESSION_ID || 'no-session';
  return {dir: dir, file: path.join(dir, sid + '.json')};
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
  fs.writeFileSync(t.file, JSON.stringify({armed: Array.from(s)}));
}

module.exports = {isArmed, arm};
