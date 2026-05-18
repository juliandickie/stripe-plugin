'use strict';

function needsScopeReview(targetCount, threshold) {
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
