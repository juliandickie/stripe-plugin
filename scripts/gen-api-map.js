'use strict';
// Build assets/stripe-api-map.json by walking the installed stripe-node client
// graph for authoritative dotted paths plus action names. HTTP method is
// derived from the stripe-node action-name convention (informational only;
// runtime classification uses src/classify.js, not this file).
const fs = require('node:fs');
const path = require('node:path');
const Stripe = require('stripe');

const OUT = path.join(__dirname, '..', 'assets', 'stripe-api-map.json');
const client = new Stripe('sk_test_placeholder_for_introspection_only');

function isResource(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return !!(proto && proto.constructor && /Resource$|Namespace$/.test(proto.constructor.name));
}

function actionsOf(obj) {
  const names = new Set();
  let p = Object.getPrototypeOf(obj);
  while (p && p !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (k === 'constructor' || k.startsWith('_')) continue;
      if (typeof obj[k] === 'function') names.add(k);
    }
    p = Object.getPrototypeOf(p);
  }
  return Array.from(names);
}

const VERB_BY_ACTION = {list: 'GET', retrieve: 'GET', search: 'GET', create: 'POST', update: 'POST', del: 'DELETE'};
function verbFor(action) {
  if (VERB_BY_ACTION[action]) return VERB_BY_ACTION[action];
  if (action.startsWith('list') || action.startsWith('retrieve')) return 'GET';
  if (action.startsWith('delete') || action === 'delete') return 'DELETE';
  return 'POST';
}

const out = {};
const seen = new Set();
function walk(node, prefix) {
  for (const key of Object.keys(node)) {
    if (key.startsWith('_') || key === 'lastResponse') continue;
    let val;
    try { val = node[key]; } catch (e) { continue; }
    if (!isResource(val)) continue;
    const dotted = prefix ? prefix + '.' + key : key;
    if (seen.has(dotted)) continue;
    seen.add(dotted);
    for (const action of actionsOf(val)) {
      out[dotted + '.' + action] = {resource: dotted, action: action, httpMethod: verbFor(action)};
    }
    walk(val, dotted);
  }
}
walk(client, '');

fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log('Wrote ' + Object.keys(out).length + ' operations to ' + OUT);
