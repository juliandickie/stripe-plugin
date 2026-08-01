# stripe

Full programmatic access to every Stripe API endpoint the pinned stripe-node SDK exposes, across many accounts, for Claude Code. Replaces the single-account Stripe MCP connector with a multi-account engine (standalone keys and Stripe Connect), a binary-enforced safety tier with live-mode arming, and the bundled official Stripe CLI for webhooks.

## Install

```
/plugin marketplace add juliandickie/stripe-plugin
/plugin install stripe@stripe-plugin
```

Then run `/stripe:stripe-setup` to create the accounts registry and provision the Stripe CLI.

## Accounts

Accounts live in a JSON registry (default `${CLAUDE_PLUGIN_DATA}/stripe-x/accounts.json`, `chmod 600`, gitignored). Each entry is `standalone` (its own test and live keys) or `connect` (a platform profile plus a connected account id). Keys are references, never plaintext: test keys may use `env:VAR_NAME` indirection; live keys must be a 1Password reference (`op://Vault/Item/field`).

## Credentials

Secret-bearing fields hold a reference, never a value. `op://Vault/Item/field` resolves through the 1Password CLI and is accepted for both `test_secret_key` and `live_secret_key`; `env:NAME` reads a process environment variable and is accepted for `test_secret_key` only. Anything else, including a raw `sk_live_...` or `sk_test_...` key, is refused at registry load. A Connect account carries no keys of its own; both fields, plus `op_account`, are read from the `platform` account it names.

1Password resolution needs the `op` CLI installed and the app unlocked. When more than one 1Password account is signed in, set `op_account` on the registry entry to the sign-in address `op` should use, or `op read` fails with "multiple accounts found". `/stripe:stripe-setup` walks through this and scaffolds a starter registry.

## Safety

Three classes enforced inside the engine binary: reads run immediately; mutating and destructive operations print a confirmation preview and do not call Stripe without `--confirm`; destructive ones state irreversibility. Test mode is default; live writes need `--live`. `--arm-live` (live-mode arming) is its own call: it arms the session for one account and exits without executing (exit code 14), so execution always needs a separate, later `--live --confirm` call. Bulk writes over the threshold return a scope review. Multi-account fan-out is read-only.

The engine enforces all of the above, but it cannot defend against a caller that writes its own flags. A `PreToolUse` hook is a required second layer that reads the harness permission mode and denies or escalates stripe-x calls Claude Code would otherwise run unattended (see Security below).

Live mutating and destructive operations also require a vetting token, proof that some permission gate saw the call, on top of arming. Inside Claude Code the `PreToolUse` guard issues one automatically for any stripe-x invocation it recognises and does not deny, so this needs no separate step. Working directly in a terminal, run `stripe-x vet` first; it requires a real terminal (a TTY) and refuses otherwise. A live call carrying no token is refused, exit code 15.

Be clear about what this layer does and does not give you. The token is scoped to the session and a five minute window, not to the individual call, so it proves that some recognised stripe-x invocation happened recently rather than that this one did. Ordinary read traffic keeps that true almost continuously. The TTY requirement on `stripe-x vet` is a presence heuristic, not proof of a human, and tools such as `script` and `expect` defeat it. Treat the guard and the vetting token as a strong speed bump against a careless or lightly injected caller, not as a hard boundary against a determined one.

## What you get

Skills: stripe-setup (user-only), stripe-api, stripe-accounts, stripe-multi-account, stripe-webhooks, stripe-reports, stripe-money-ops (user-only). Agent: stripe-bulk-runner. Optional MCP shim (off by default; set enable_mcp_shim).

## Pinned versions

stripe-node 22.1.1, Stripe API 2026-04-22.dahlia, Stripe CLI pinned in scripts/stripe-cli-version.txt.

## Testing

`node --test test/*.test.js` runs the full suite with no network and no keys. The plugin never needs live keys to test.

## Security

No secrets in the repo. Two hooks: `SessionStart` installs the npm dependency and provisions the Stripe CLI; `PreToolUse` gates stripe-x Bash calls (see Safety above) whenever Claude Code is in a permission mode that would not otherwise prompt - `auto`, `dontAsk`, `bypassPermissions`, or any unrecognised mode. Review before installing.
