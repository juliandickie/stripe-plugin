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

function genIdempotencyKey() {
  return 'stripex-' + crypto.randomUUID();
}

async function callStripe(client, resourcePath, action, req) {
  const r = resolveMethod(client, resourcePath, action);
  const fn = r.fn;
  // Shallow-copy so injecting expand never mutates the caller's req.params.
  const params = Object.assign({}, req.params || {});
  if (req.expand && req.expand.length) params.expand = req.expand;
  const options = Object.assign({}, req.options || {});
  if (action === 'create' && !options.idempotencyKey) {
    options.idempotencyKey = genIdempotencyKey();
  }

  // stripe-node's argument convention is uniform: collection operations take
  // (params, opts); operations on a specific resource take (id, params, opts).
  // list/search return a pageable. We discriminate instance vs collection by
  // whether the caller supplied an id (via --id). This is correct for the
  // entire surface with no per-action allowlist - including id-first actions
  // like paymentIntents.confirm and singletons like balance.retrieve (no id).
  const hasId = req.id !== undefined && req.id !== null && req.id !== '';
  let result;
  if (action === 'list' || action === 'search') {
    const ret = fn(params, options);
    result = req.all ? await ret.autoPagingToArray({limit: req.limit || 10000}) : await ret;
  } else if (hasId) {
    result = await fn(req.id, params, options);
  } else {
    result = await fn(params, options);
  }
  return result;
}

function preflight(apiMap, resourcePath, action) {
  const camel = camelizePath(resourcePath);
  const key = camel + '.' + action;
  if (apiMap[key]) return {ok: true, info: apiMap[key]};
  const head = camel.split('.')[0];
  const near = Object.keys(apiMap).filter((k) => k.indexOf(head) === 0).slice(0, 8);
  return {ok: false, message: 'Unknown operation "' + key + '". Did you mean: ' + (near.join(', ') || '(none)') + '. Run `stripe-x help ' + resourcePath + '`.'};
}

module.exports = {camelizePath, resolveMethod, callStripe, genIdempotencyKey, preflight};
