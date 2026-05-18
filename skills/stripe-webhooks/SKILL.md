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

## Live events and test events (bundled Stripe CLI)

The bundled CLI binary is at `${CLAUDE_PLUGIN_DATA}/stripe-cli/<pinned-version>/stripe`. Invoke it with the resolved account key. `stripe listen` is long-running: start it as a background task and tail its log. `stripe trigger <event>` is blocked by the engine in live mode and only runs in test mode. `stripe logs tail` is read-only and allowed in live with no arming.

Always confirm endpoint creation and deletion previews with the user before `--confirm`.
