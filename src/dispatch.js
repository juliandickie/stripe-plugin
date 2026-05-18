'use strict';
const crypto = require('node:crypto');

function camelizePath(p) {
  return p.split('.').map((seg) =>
    seg.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
  ).join('.');
}

function resolveMethod(client, resourcePath, action) {
  const camel = camelizePath(resourcePath);
  const segs = camel.split('.');
  let node = client;
  for (const s of segs) {
    if (node == null || typeof node[s] === 'undefined') {
      throw new Error('Unknown Stripe resource path "' + resourcePath + '" (failed at "' + s + '").');
    }
    node = node[s];
  }
  if (typeof node[action] !== 'function') {
    throw new Error('Unknown action "' + camel + '.' + action + '". Check `stripe-x help ' + resourcePath + '`.');
  }
  return {fn: node[action].bind(node), resourceSegment: segs[segs.length - 1]};
}

const ID_FIRST_ACTIONS = new Set(['retrieve', 'update', 'del', 'delete', 'cancel', 'capture', 'close', 'resume', 'pay', 'finalizeInvoice', 'voidInvoice', 'markUncollectible', 'approve', 'decline', 'reject', 'verify', 'detach', 'reverse']);

function genIdempotencyKey() {
  return 'stripex-' + crypto.randomUUID();
}

async function callStripe(client, resourcePath, action, req) {
  const r = resolveMethod(client, resourcePath, action);
  const fn = r.fn;
  const params = req.params || {};
  if (req.expand && req.expand.length) params.expand = req.expand;
  const options = Object.assign({}, req.options || {});
  if (action === 'create' && !options.idempotencyKey) {
    options.idempotencyKey = genIdempotencyKey();
  }

  let result;
  if (ID_FIRST_ACTIONS.has(action)) {
    if (!req.id) throw new Error('Action "' + action + '" requires --id.');
    if (action === 'del' || action === 'delete') {
      result = await fn(req.id, options);
    } else {
      result = await fn(req.id, params, options);
    }
  } else if (action === 'list' || action === 'search') {
    const ret = fn(params, options);
    if (req.all) {
      result = await ret.autoPagingToArray({limit: req.limit || 10000});
    } else {
      result = await ret;
    }
  } else {
    result = await fn(params, options);
  }
  return result;
}

module.exports = {camelizePath, resolveMethod, callStripe, genIdempotencyKey};
