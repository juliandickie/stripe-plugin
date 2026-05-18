'use strict';

// Read actions: never gated.
// Frozen array — genuinely immutable. Module-private Set for O(1) lookup.
const READ_ACTIONS = Object.freeze(['list', 'retrieve', 'search', 'listLineItems', 'listPaymentMethods', 'retrievePaymentMethod', 'listComputedUpfrontLineItems']);
const _read = new Set(READ_ACTIONS);

// Money-moving or otherwise irreversible operations that are POSTs and would
// otherwise read as plain mutating. Keyed by "<resourceSegment>.<action>"
// where resourceSegment is the last namespace element used in dispatch.
// Frozen array — genuinely immutable. Module-private Set for O(1) lookup.
const DESTRUCTIVE = Object.freeze([
  'refunds.create', 'refunds.cancel',
  'payouts.create', 'payouts.cancel', 'payouts.reverse',
  'transfers.create', 'transfers.createReversal',
  'subscriptions.cancel', 'subscriptions.resume',
  'subscriptionItems.del',
  'paymentIntents.cancel',
  'invoices.del', 'invoices.voidInvoice', 'invoices.markUncollectible',
  'disputes.close',
  'sources.detach',
  'accounts.del', 'accounts.reject',
  'applicationFees.createRefund',
  'creditNotes.create', 'creditNotes.voidCreditNote',
  'topups.cancel',
  'reviews.approve',
  'cards.create',
  'readers.cancelAction',
  // Execute or capture a payment, or move funds: cannot be undone.
  'paymentIntents.capture', 'paymentIntents.confirm',
  'charges.capture',
  'invoices.pay',
  'topups.create',
]);
const _dest = new Set(DESTRUCTIVE);

function classify(resourceSegment, action) {
  if (_read.has(action) || action.startsWith('list') || action.startsWith('retrieve')) {
    return 'read';
  }
  if (action === 'del' || action === 'delete' || action.startsWith('delete')) {
    return 'destructive';
  }
  if (_dest.has(resourceSegment + '.' + action)) {
    return 'destructive';
  }
  // create, update, and any unknown action: safe minimum is mutating.
  return 'mutating';
}

module.exports = {classify, DESTRUCTIVE, READ_ACTIONS};
