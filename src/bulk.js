'use strict';

function needsScopeReview(targetCount, threshold) {
  // Fail safe: a malformed threshold forces scope review rather than silently skipping it.
  if (typeof threshold !== 'number' || Number.isNaN(threshold)) return true;
  return targetCount > threshold;
}

function scopeReview(resourceSegment, action, targets) {
  return {
    kind: 'scope_review_required',
    action: resourceSegment + '.' + action,
    count: targets.length,
    targets: targets.slice()
  };
}

module.exports = {needsScopeReview, scopeReview};
