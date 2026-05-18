'use strict';

function scrubSecrets(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\bsk_(live|test)_[A-Za-z0-9]{6,}/g, 'sk_$1_***')
          .replace(/\brk_(live|test)_[A-Za-z0-9]{6,}/g, 'rk_$1_***');
}

function mapStripeError(err) {
  return {
    type: err && err.type ? err.type : (err && err.name) || 'Error',
    raw_type: err && err.rawType,
    code: scrubSecrets(err && err.code),
    message: scrubSecrets(err && err.message),
    param: scrubSecrets(err && err.param),
    doc_url: scrubSecrets(err && err.doc_url),
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
    .map((r) => (r.account || '(unknown)') + ' failed: ' + ((r.error && (r.error.code || r.error.type || r.error.message)) || '(no detail)'));
  let summary = succeeded + ' of ' + results.length + ' succeeded';
  if (failed > 0) summary += '. ' + failParts.join('; ');
  return {ok: failed === 0, succeeded: succeeded, failed: failed, summary: summary, results: results};
}

module.exports = {mapStripeError, aggregate};
