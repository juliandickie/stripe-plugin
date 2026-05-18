# stripe

Full programmatic access to every Stripe API endpoint across many accounts, for Claude Code. Replaces the single-account Stripe MCP connector with a multi-account engine (standalone keys and Stripe Connect), a binary-enforced safety tier with live-mode arming, and the bundled official Stripe CLI for webhooks.

## Install

```
/plugin marketplace add juliandickie/stripe-plugin
/plugin install stripe@stripe-plugin
```

Then run `/stripe:stripe-setup` to create the accounts registry and provision the Stripe CLI.

## Accounts

Accounts live in a JSON registry (default `${CLAUDE_PLUGIN_DATA}/stripe-x/accounts.json`, `chmod 600`, gitignored). Each entry is `standalone` (its own test and live keys) or `connect` (a platform profile plus a connected account id). Live keys should use `env:VAR_NAME` indirection.

## Safety

Three classes enforced inside the engine binary: reads run immediately; mutating and destructive operations print a confirmation preview and do not call Stripe without `--confirm`; destructive ones state irreversibility. Test mode is default; live writes need `--live` and a per-session `--arm-live` (live-mode arming). Bulk writes over the threshold return a scope review. Multi-account fan-out is read-only.

## What you get

Skills: stripe-setup (user-only), stripe-api, stripe-accounts, stripe-multi-account, stripe-webhooks, stripe-reports, stripe-money-ops (user-only). Agent: stripe-bulk-runner. Optional MCP shim (off by default; set enable_mcp_shim).

## Pinned versions

stripe-node 22.1.1, Stripe API 2026-04-22.dahlia, Stripe CLI pinned in scripts/stripe-cli-version.txt.

## Testing

`node --test test/*.test.js` runs the full suite with no network and no keys. The plugin never needs live keys to test.

## Security

No secrets in the repo. Hooks: a single SessionStart hook installs the npm dependency and provisions the Stripe CLI. Review before installing.
