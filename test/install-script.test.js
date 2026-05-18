const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('pinned version file is a concrete semver', () => {
  const v = fs.readFileSync(__dirname + '/../scripts/stripe-cli-version.txt', 'utf8').trim();
  assert.match(v, /^\d+\.\d+\.\d+$/);
});

test('install script is executable with shebang, strict mode, and checksum verify', () => {
  const p = __dirname + '/../scripts/install-stripe-cli.sh';
  fs.accessSync(p, fs.constants.X_OK);
  const s = fs.readFileSync(p, 'utf8');
  assert.match(s, /^#!\/usr\/bin\/env bash/);
  assert.match(s, /set -euo pipefail/);
  assert.match(s, /shasum -a 256 -c/);
  assert.match(s, /stripe-cli-version\.txt/);
});

test('hooks.json declares a SessionStart command hook', () => {
  const h = JSON.parse(fs.readFileSync(__dirname + '/../hooks/hooks.json', 'utf8'));
  assert.ok(Array.isArray(h.hooks.SessionStart));
  const cmd = h.hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, /install-stripe-cli\.sh/);
});

const {spawnSync} = require('node:child_process');
const os = require('node:os');
const pathMod = require('node:path');

// Reproduces the script's exact verify->extract ordering in a sandbox so we
// test the fail-closed property behaviorally (no network, no real binary).
function runVerify(checksumsContent, tarballBytes) {
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'verify-'));
  fs.writeFileSync(pathMod.join(dir, 'app.tar.gz'), tarballBytes);
  fs.writeFileSync(pathMod.join(dir, 'checksums.txt'), checksumsContent);
  const script = [
    'set -euo pipefail',
    'cd "$1"',
    'tarball=app.tar.gz',
    '( grep " ${tarball}\\$" checksums.txt | shasum -a 256 -c - )',
    'echo EXTRACT_REACHED'
  ].join('\n');
  const r = spawnSync('bash', ['-c', script, 'bash', dir], {encoding: 'utf8'});
  return {status: r.status, out: (r.stdout || '') + (r.stderr || ''), dir};
}
function sha256(buf) {
  return require('node:crypto').createHash('sha256').update(buf).digest('hex');
}

test('checksum verify FAILS CLOSED on empty checksums (no extract)', () => {
  const r = runVerify('', Buffer.from('binarydata'));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.out, /EXTRACT_REACHED/);
});

test('checksum verify FAILS CLOSED on wrong hash (no extract)', () => {
  const r = runVerify('0000000000000000000000000000000000000000000000000000000000000000  app.tar.gz\n', Buffer.from('binarydata'));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.out, /EXTRACT_REACHED/);
});

test('checksum verify FAILS CLOSED on substituted filename (no extract)', () => {
  const data = Buffer.from('binarydata');
  const r = runVerify(sha256(data) + '  some_other_file.tar.gz\n', data);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.out, /EXTRACT_REACHED/);
});

test('checksum verify PASSES and reaches extract on a correct hash', () => {
  const data = Buffer.from('the real binary bytes');
  const r = runVerify(sha256(data) + '  app.tar.gz\n', data);
  assert.equal(r.status, 0);
  assert.match(r.out, /EXTRACT_REACHED/);
});
