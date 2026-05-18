---
name: stripe-multi-account
description: Run one Stripe read across many or all accounts and consolidate. Use when the user asks for a cross-account view, for example (1) total balances across all accounts, (2) all active subscriptions across the group, (3) every open dispute across accounts, or (4) compare a metric across businesses. Read-only by construction.
allowed-tools: Bash Read
---

# Stripe Multi-Account

The headline capability the single-account connector lacks. Fan a single read across accounts.

## Rules

1. Use `--account all` or a comma list. The engine returns `{ ok, succeeded, failed, summary, results: [{account, ok, data|error}] }`.

2. This is read-only. The engine refuses mutating and destructive actions in fan-out. Never attempt a cross-account write; do each write as a separate single-account confirmed call.

3. Report the per-account breakdown and the fail-loud summary verbatim. If `ok` is false, state which accounts failed and why; never present a partial result as complete.

## Examples

Balances across every account:
`${CLAUDE_PLUGIN_ROOT}/bin/stripe-x balance retrieve --account all`

Active subscriptions across three accounts:
`${CLAUDE_PLUGIN_ROOT}/bin/stripe-x subscriptions list --account idd,promktg,acme --data status=active --all`
