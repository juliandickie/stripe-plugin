---
name: stripe-accounts
description: Inspect and switch Stripe accounts. Use when the user asks (1) which Stripe accounts are configured, (2) to switch the default account, (3) what mode an account is in, or (4) to check account setup. Read-only. Never prints secret keys.
allowed-tools: Bash Read
---

# Stripe Accounts

List and inspect configured accounts. This skill never prints secret key values; show only the last 4 characters and the type and mode availability.

## Steps

1. Load the registry (same path precedence as setup) and list each account: name, label, type (standalone or connect), and for connect the platform and connected_account.

2. For a connectivity check, run `${CLAUDE_PLUGIN_ROOT}/bin/stripe-x balance retrieve --account <name>` in test mode and report pass or fail only.

3. To change the default account, edit `default_account` in the registry after confirming with the user. Do not modify keys.

Mask any secret to the last 4 characters in all output.
