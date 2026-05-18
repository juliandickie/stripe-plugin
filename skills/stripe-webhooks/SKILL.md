---
name: stripe-webhooks
description: Manage Stripe webhooks and CLI extras. Use when the user asks to (1) create, list, or delete webhook endpoints, (2) listen to live events locally, (3) trigger test events, or (4) tail API logs. Endpoint CRUD is REST and inherits the safety tier; listen and trigger use the bundled Stripe CLI.
allowed-tools: Bash Read
---

# Stripe Webhooks

## Endpoint CRUD (REST through the engine)

`stripe-x webhookEndpoints list --account <name>`
`stripe-x webhookEndpoints create --account <name> --data url=https://... --data 'enabled_events[]=*'` (mutating, confirmed)
`stripe-x webhookEndpoints del --id we_123 --account <name>` (destructive, confirmed)

## Live events and test events (engine-wrapped bundled Stripe CLI)

Invoke the bundled Stripe CLI ONLY through the engine wrapper, never the raw binary, so the per-account key is injected and `stripe trigger` is blocked in live by the binary:

`${CLAUDE_PLUGIN_ROOT}/bin/stripe-x cli listen --account <name>`  (long-running: run as a background task, tail its output)

`${CLAUDE_PLUGIN_ROOT}/bin/stripe-x cli trigger <event> --account <name>`  (test-mode only; the engine refuses `stripe trigger` when --live is set)

`${CLAUDE_PLUGIN_ROOT}/bin/stripe-x cli logs tail --account <name>`  (read-only; allowed in live)

The wrapper resolves the account (standalone or Connect), passes `--api-key` (and `--stripe-account` for Connect), refuses `trigger` in live mode, and execs the pinned bundled binary at `${CLAUDE_PLUGIN_DATA}/stripe-cli/<pinned-version>/stripe`. Do not run that binary directly.

Always confirm endpoint creation and deletion previews with the user before `--confirm`.
