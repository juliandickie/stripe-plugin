const {test} = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('package declares name, bin, and node engine', () => {
  assert.equal(pkg.name, 'stripe-x-engine');
  assert.equal(pkg.bin['stripe-x'], 'bin/stripe-x');
  assert.match(pkg.engines.node, />=18/);
  assert.equal(pkg.dependencies.stripe, '22.1.1');
});
