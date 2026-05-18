# Changelog

All notable changes to the stripe plugin are recorded here.

## 0.1.0 - 2026-05-18

Initial release.

- Reflective dispatcher over stripe-node 22.1.1 (pinned). Pinned Stripe API version 2026-04-22.dahlia (the stripe-node 22.1.1 default).

- Multi-account resolver: standalone keys and Connect (platform key plus connected account). Read-only fan-out across many or all accounts.

- Binary-enforced three-class safety tier (read, mutating, destructive) with orthogonal live-mode session arming and bulk scope review.

- Payment-execution and fund-movement operations (paymentIntents.capture, paymentIntents.confirm, charges.capture, invoices.pay, topups.create) are classified destructive so they show the IRREVERSIBLE confirmation preview, alongside refunds, payouts, transfers, cancels, and deletes.

- Bundled official Stripe CLI provisioning (pinned, checksum-verified) for listen, trigger, logs tail, fixtures, samples.

- Seven skills, one bulk-runner agent, opt-in MCP shim.

- Dual-marketplace distribution: standalone self-marketplace plus a decoupled outfit-catalog entry.
