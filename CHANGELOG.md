# Changelog

All notable changes to the stripe plugin are recorded here.

## Unreleased

## 0.2.0 - 2026-08-02

Credential and permission hardening. Answers an external security question from 2026-07-29 about what enforces the boundary between an agent's decision and execution of a destructive Stripe call. Four breaking changes, all listed below.

- Breaking - the accounts registry no longer accepts plaintext secret values. `test_secret_key` and `live_secret_key` now hold a reference only: `op://Vault/Item/field` (1Password, valid for either key) or `env:NAME` (valid for test keys only). A plaintext secret, or an `env:` live key, is refused at registry load. An optional `op_account` per account selects among multiple signed-in 1Password accounts; for a Connect account both the key and `op_account` come from its platform record. No keychain backend.

- `--arm-live` now arms and exits (exit code 14) instead of arming and continuing in the same call. It requires `--live` and a single `--account`, each otherwise a usage error (exit 2). Arming and executing can therefore never happen in the same process: a `--live --arm-live` call must complete first, and only a later, separate `--live --confirm` call executes.

- New `PreToolUse` hook (`hooks/pretooluse-stripe-guard.js`) gates stripe-x Bash calls whenever Claude Code is in a permission mode that does not otherwise prompt (`auto`, `dontAsk`, `bypassPermissions`, or any unrecognised mode): denies anything that looks live, asks for writes and for anything it cannot prove is a simple read, and defers only a single simple read. Registered in `hooks/hooks.json`, and also recommended in the user's own settings (see stripe-setup). Shares `src/classify.js` with the engine's own gates.

- Live mutating and destructive operations, live arming, and live calls through the `stripe-x cli` bridge now require a vetting token (`src/vetting.js`), proof that a permission gate saw that specific call, on top of arming. The token is bound to a canonical key covering the account, registry path, resource, action, live flag, arm flag, target id and bulk ids, which the `PreToolUse` guard and the engine compute independently, so a token for one operation authorises nothing else and an invocation no gate could parse produces no token at all. The guard issues one automatically. Outside Claude Code, `stripe-x vet <resource> <action> --live` issues a token for exactly one named operation from an interactive terminal; it requires a real TTY. A live call carrying no matching token is refused with exit code 15.
- BREAKING, `stripe-x vet` no longer takes a bare form. It must name the operation it authorises, because a blanket session token was the hole this replaced.
- BREAKING, the `stripe-x cli` bridge now carries the engine's own gates instead of its own lighter set. It classifies the subcommand against a frozen read list in `src/cli_bridge.js` (anything not on it counts as mutating, including subcommands that do not exist yet), requires `--confirm` for a non-read in either mode, and requires arming plus vetting for a live non-read. It previously returned before classification, arming and vetting were reached, and resolved the live key regardless. Refusals and previews now return before the key is resolved, so they cost no 1Password read.
- Known residuals, stated rather than glossed: the target is bound through `--id` and `--bulk-ids` but not through `--data`, so an operation targeted via `--data` can still be re-aimed within the token's five minute window; and the `stripe-x vet` TTY check is a presence heuristic that `script` and `expect` defeat, not proof of a human.

## 0.1.0 - 2026-05-18

Initial release.

- Reflective dispatcher over stripe-node 22.1.1 (pinned). Pinned Stripe API version 2026-04-22.dahlia (the stripe-node 22.1.1 default).

- Multi-account resolver: standalone keys and Connect (platform key plus connected account). Read-only fan-out across many or all accounts.

- Binary-enforced three-class safety tier (read, mutating, destructive) with orthogonal live-mode session arming and bulk scope review.

- Payment-execution and fund-movement operations (paymentIntents.capture, paymentIntents.confirm, charges.capture, invoices.pay, topups.create) are classified destructive so they show the IRREVERSIBLE confirmation preview, alongside refunds, payouts, transfers, cancels, and deletes.

- Bundled official Stripe CLI provisioning (pinned, checksum-verified) for listen, trigger, logs tail, fixtures, samples.

- Seven skills, one bulk-runner agent, opt-in MCP shim.

- Dual-marketplace distribution: standalone self-marketplace plus a decoupled outfit-catalog entry.
