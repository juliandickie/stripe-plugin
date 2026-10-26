# Changelog

All notable changes to the stripe plugin are recorded here.

## Unreleased

- Breaking - bumped the pinned stripe-node SDK from 22.6.2 to 23.0.1 (23.0.0, then its 23.0.1 patch on 2026-10-26). The pinned Stripe API version moves from 2026-08-26.dahlia to 2026-09-30.endive, and because the dispatcher is reflective every call now goes out on endive unless `--api-version` overrides it. Endive removes `payment_method_types` from Checkout Sessions, PaymentIntents, SetupIntents and Elements, deprecates the payment request button, and enforces billing address collection for non-EEA SEPA Direct Debit. Pass `--api-version 2026-08-26.dahlia` for a call that still needs the old behaviour.
- Breaking - the engine now needs Node.js 20 or later (`engines.node` was `>=18`), because stripe-node 23 drops Node 18.
- Regenerated the API map: 737 operations (was 715), 22 added, none removed or changed. New: `apps.installs.*` (create, list, retrieve, update, uninstall), `productCatalog.trialOffers.*` (create, list, retrieve, update), `subscriptions.pause`, `tax.locations.*` (create, list, retrieve), `threeDSecure.authentications.*` (create, list, retrieve, cancel, submit), plus their `initialize` helpers. All classify as mutating by the default rule; none is added to the destructive list. Arity re-probe found every new instance op at 3 and every new collection op at 2; the only exceptions on the whole surface remain the known singletons (balanceSettings.update, tax.settings.update) and the parent-scoped creates (v2.core.accounts.persons and personTokens).
- Upstream notes worth knowing: incomplete response bodies now throw `StripeConnectionError` instead of `StripeAPIError`; `webhooks.signature.verifyHeader` now applies the default timestamp tolerance when none is given; `Stripe.constructEventWithoutVerification` and the `ErrorType` export are removed (the engine uses neither).
- 23.0.1 is a patch on the same API version (2026-09-30.endive) - it rejects webhook signing secrets made only of whitespace, adds API v2 Search with auto-pagination, verifies `EventNotificationHandler` signatures asynchronously, disposes discarded fetch responses before a retry, and fills `lastResponse.statusCode` for fetch responses. The engine verifies no webhooks itself. Re-checked at the bump - the regenerated API map is byte-identical to 23.0.0's (737 operations), and the arity of all 737 is unchanged.

## 0.2.1 - 2026-09-10

- Fixed - the PreToolUse guard no longer emits `permissionDecision: "defer"` for commands it has no opinion on (everything that does not invoke stripe-x, plus prompting modes and proven simple reads). Claude Code 2.1.260 started honouring the literal value `defer` as "park this tool call in the user's deferred-tool queue", which in auto and bypassPermissions modes never resolves, so every non-Stripe Bash command in every Claude Code session hung with no result (found 2026-09-10). The guard now emits an empty object `{}` for no opinion, the documented hook no-op. Deny and ask are unchanged. Anyone running 0.2.0 on Claude Code 2.1.260 or later needs this fix.

- Bumped the pinned stripe-node SDK from 22.1.1 to 22.6.1. Pinned Stripe API version moves from 2026-04-22.dahlia to 2026-08-26.dahlia. Regenerated the API map: 715 operations (was 703), 12 added, none removed or changed. New: `accounts.unreject`, `billing.feedbackOptions.*` (create, deactivate, list, retrieve, update), `paymentRecords.list`, `v2.commerce.productCatalog.imports.*` (create, list, retrieve). Arity re-probe found no shape changes; the only sub-3 instance-style ops are the known singletons (balance, balanceSettings, tax.settings, accounts.retrieveCurrent, billing.creditBalanceSummaries, apps.secrets.deleteWhere) and the only 3-arity collection ops are nested under a parent id (v2.core.accounts.persons and personTokens), both as before. Upstream notes worth knowing: 22.6.1 hardens multipart upload boundaries and URL handling; 22.6.0 throws on a discriminated-union V2 param with a missing discriminator instead of silently skipping coercion, and throws a connection error when the server drops mid-response instead of hanging.

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
