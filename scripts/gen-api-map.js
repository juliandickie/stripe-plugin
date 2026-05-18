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

// A walkable node is any class instance that is a leaf resource OR a namespace
// container. stripe-node leaf resources have constructor names ending in
// "Resource"; namespace objects are plain PascalCase class names (Issuing,
// Treasury, Billing, Checkout, etc.) that do NOT end in "Resource".
// We accept both by matching: constructor name ends in "Resource", OR
// constructor name is a single PascalCase word (no spaces, starts uppercase,
// not "Object", not "Stripe" — the Stripe client itself appears as a
// back-reference inside every namespace via the "stripe" property and must
// be excluded to prevent circular re-walking).
function isResource(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  if (!proto || proto === Object.prototype) return false;
  const name = proto.constructor ? proto.constructor.name : '';
  if (!name || name === 'Object' || name === 'Stripe') return false;
  // Accept *Resource leaf nodes and PascalCase namespace nodes
  return /Resource$/.test(name) || /^[A-Z][A-Za-z0-9]+$/.test(name);
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
const seenPaths = new Set();   // guard dotted-path duplicates
const seenObjs = new WeakSet(); // guard object-identity cycles (e.g. shared namespace refs)
function walk(node, prefix) {
  for (const key of Object.keys(node)) {
    if (key.startsWith('_') || key === 'lastResponse') continue;
    let val;
    try { val = node[key]; } catch (e) { continue; }
    if (val === client) continue; // class-name-independent guard against the namespace .stripe back-reference (prevents the walk exploding)
    if (!isResource(val)) continue;
    if (seenObjs.has(val)) continue;
    const dotted = prefix ? prefix + '.' + key : key;
    if (seenPaths.has(dotted)) continue;
    seenPaths.add(dotted);
    seenObjs.add(val);
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
