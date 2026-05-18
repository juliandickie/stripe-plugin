'use strict';

// Read actions: never gated.
const READ_ACTIONS = new Set(['list', 'retrieve', 'search', 'listLineItems', 'listPaymentMethods', 'retrievePaymentMethod', 'listComputedUpfrontLineItems']);

// Money-moving or otherwise irreversible operations that are POSTs and would
// otherwise read as plain mutating. Keyed by "<resourceSegment>.<action>"
// where resourceSegment is the last namespace element used in dispatch.
const DESTRUCTIVE = new Set([
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
  'readers.cancelAction'
]);
Object.freeze(DESTRUCTIVE);

function classify(resourceSegment, action) {
  if (READ_ACTIONS.has(action) || action.startsWith('list') || action.startsWith('retrieve')) {
    return 'read';
  }
  if (action === 'del' || action === 'delete' || action.startsWith('delete')) {
    return 'destructive';
  }
  if (DESTRUCTIVE.has(resourceSegment + '.' + action)) {
    return 'destructive';
  }
  // create, update, and any unknown action: safe minimum is mutating.
  return 'mutating';
}

module.exports = {classify, DESTRUCTIVE, READ_ACTIONS};
