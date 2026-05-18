---
name: stripe-reports
description: Stripe reporting and financial summaries. Use when the user asks for (1) a Reporting API report run, (2) a Sigma-style financial summary, (3) payout or balance-transaction reconciliation, or (4) a cross-account revenue snapshot. Reads run immediately; creating a report run is mutating and is confirmed.
allowed-tools: Bash Read
---

# Stripe Reports

## Steps

1. For a financial overview prefer reads: `balance retrieve`, `balanceTransactions list --all`, `payouts list`, `charges list`.

2. For a Reporting report run, `reporting.reportRuns create` is a mutating call and will require `--confirm`. Relay the confirmation preview first.

3. For cross-account summaries, use `--account all` with read actions and present the per-account breakdown plus the fail-loud summary.

Never present a partial cross-account total as if complete; quote the summary line from the engine.
