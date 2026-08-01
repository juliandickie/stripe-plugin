---
name: stripe-api
description: Call any Stripe API endpoint. This skill should be used when the user asks to (1) read or look up any Stripe data (customers, charges, subscriptions, invoices, payment intents, balances, payouts, disputes, Connect accounts, Issuing, Treasury, Tax, Billing, Reporting, anything), (2) create or update Stripe objects, or (3) perform any Stripe operation by name. Covers the entire Stripe REST surface across all configured accounts.
allowed-tools: Bash Read
---

# Stripe API

Every Stripe endpoint the pinned stripe-node SDK exposes is reachable through the bundled engine. Do not hand-write HTTP calls.

## Command grammar

```
${CLAUDE_PLUGIN_ROOT}/bin/stripe-x <resource.path> <action> \
  [--account <name|comma-list|all>] [--live] \
  [--id <id>] [--params '<json>'] [--data k=v --data a[b]=c] \
  [--expand a,b] [--limit N | --all] \
  [--idempotency-key K] [--api-version YYYY-MM-DD] \
  [--confirm] [--confirm-bulk] [--arm-live] [--table]
```

`resource.path` is the dotted SDK path in snake or camel case: `customers`, `checkout.sessions`, `issuing.cards`, `treasury.financial_accounts`, `reporting.report_runs`. `action` is `list`, `retrieve`, `create`, `update`, `del`, `search`, `cancel`, `capture`, and so on.

## Rules

1. Reads (`list`, `retrieve`, `search`) run immediately and may target `--account all` or a comma list for a consolidated, per-account-tagged result.

2. Writes need a single `--account`. The engine prints a CONFIRMATION REQUIRED preview and exits without calling Stripe unless `--confirm` is passed. Relay the preview to the user and only re-run with `--confirm` after they approve.

3. Test mode is default. Live mode needs `--live`. Arming is a separate call: `--live --arm-live` arms the session for that account and exits 14 without executing. Only then does `--live --confirm` run the operation, and only with explicit approval in the same turn.

4. Bulk writes use `--bulk-ids id1,id2,...`. Over the threshold the engine returns a scope review listing every target; relay it and only proceed with `--confirm-bulk` after approval.

5. Discover shape with `${CLAUDE_PLUGIN_ROOT}/bin/stripe-x help <resource.path>` (reads `assets/stripe-api-map.json`).

## Examples

List 3 customers in test mode for one account:
`stripe-x customers list --account idd --data limit=3`

Retrieve a charge:
`stripe-x charges retrieve --id ch_123 --account idd`

Create a price (mutating, will require --confirm):
`stripe-x prices create --account idd --data unit_amount=2000 --data currency=usd --data 'product_data[name]=Demo'`
