---
name: stripe-money-ops
description: Irreversible Stripe money operations - refunds, payouts, transfers, subscription cancels, deletes. User-invoked only. This skill is intentionally excluded from automatic model invocation because these operations move real money and cannot be undone.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash Read
---

# Stripe Money Operations

These operations are irreversible. The engine classifies them destructive and will require an explicit confirmation preview, and in live mode prior `--arm-live`.

## Procedure

1. State exactly what will happen: account, mode, amount, target id, irreversibility.

2. Run without `--confirm` first and show the engine CONFIRMATION REQUIRED preview to the user verbatim.

3. Only after explicit user approval in the same turn, re-run with `--confirm`. For live, arming is a separate call: run `--live --arm-live` first (it arms and exits, exit 14), then re-run the operation with `--live --confirm`. Each is a separate approval.

4. Never batch. For multiple targets use `--bulk-ids` and relay the scope review; proceed only with `--confirm-bulk` after approval.

## Examples

Refund a charge (test): `stripe-x refunds create --account idd --data charge=ch_123 --confirm`
Cancel a subscription (test): `stripe-x subscriptions cancel --id sub_123 --account idd --confirm`
Refund a charge (live, three calls): `stripe-x refunds create --account idd --live --arm-live` then show the preview with `--live`, then `--live --confirm`.
