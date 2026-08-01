---
name: stripe-money-ops
description: Irreversible Stripe money operations - refunds, payouts, transfers, subscription cancels, deletes. User-invoked only. This skill is intentionally excluded from automatic model invocation because these operations move real money and cannot be undone.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash Read
---

# Stripe Money Operations

These operations are irreversible. The engine classifies them destructive and will require an explicit confirmation preview, and in live mode prior `--arm-live` plus a vetting token (see step 3).

## Procedure

1. State exactly what will happen: account, mode, amount, target id, irreversibility.

2. Run without `--confirm` first and show the engine CONFIRMATION REQUIRED preview to the user verbatim. This preview never resolves the secret, live or test, so it never costs a 1Password prompt.

3. Only after explicit user approval in the same turn, re-run with `--confirm`. For live, this is three separate calls inside Claude Code, each its own approval: arm with `--live --arm-live` first (it arms and exits, exit 14), preview with `--live` alone (step 2 above), then execute with `--live --confirm`. The PreToolUse guard issues the vetting token each of these needs automatically, so no separate vetting step is needed here. If a live call is ever refused with exit 15, that means it carried no vetting token because no permission gate recognised it as this engine (most likely an unusual shell construct); the fix is to run the plain operation again, not to retry the same unrecognised form.

4. Never batch. For multiple targets use `--bulk-ids` and relay the scope review; proceed only with `--confirm-bulk` after approval.

## Examples

Refund a charge (test): `stripe-x refunds create --account idd --data charge=ch_123 --confirm`
Cancel a subscription (test): `stripe-x subscriptions cancel --id sub_123 --account idd --confirm`
Refund a charge (live, three calls): `stripe-x refunds create --account idd --live --arm-live` then show the preview with `--live`, then `--live --confirm`.
