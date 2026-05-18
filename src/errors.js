'use strict';

function mapStripeError(err) {
  return {
    type: err && err.type ? err.type : (err && err.name) || 'Error',
    raw_type: err && err.rawType,
    code: err && err.code,
    message: err && err.message,
    param: err && err.param,
    doc_url: err && err.doc_url,
    request_id: err && err.requestId,
    status_code: err && err.statusCode
  };
}

// Callers must populate `account` (and, on failures, `error`) on every result
// entry; the summary labels each failure by `account`.
function aggregate(results) {
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const failParts = results
    .filter((r) => !r.ok)
    .map((r) => r.account + ' failed: ' + (r.error && (r.error.code || r.error.type || r.error.message)));
  let summary = succeeded + ' of ' + results.length + ' succeeded';
  if (failed > 0) summary += '. ' + failParts.join('; ');
  return {ok: failed === 0, succeeded: succeeded, failed: failed, summary: summary, results: results};
}

module.exports = {mapStripeError, aggregate};
