---
name: stripe-setup
description: Set up the stripe plugin. Use when the user asks to (1) configure Stripe accounts, (2) add or change Stripe API keys, (3) install the Stripe CLI, or (4) verify Stripe connectivity. Scaffolds the multi-account registry and provisions the bundled Stripe CLI.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash Read Write
---

# Stripe Setup

Configure the multi-account registry and provision the Stripe CLI. This skill is user-invoked only because it writes credential configuration.

## Prerequisite - 1Password CLI

Any `op://` reference, for a test key or a live key, resolves through the 1Password CLI (`op`) at call time; the registry stores only the reference, never the secret.

- Confirm `op` is installed: `op --version`. If not, `brew install 1password-cli`.
- Confirm the 1Password app is unlocked. A locked app makes `op read` fail, or hang until the timeout (default 60 seconds, override with `CLAUDE_PLUGIN_OPTION_OP_TIMEOUT`).
- If more than one 1Password account is signed in, `op read` alone fails with "multiple accounts found"; step 4 below sets `op_account` to resolve that.

## Steps

1. Determine the registry path with this precedence: a `--accounts-file` the user names, else `$STRIPE_X_ACCOUNTS_FILE`, else the `accounts_file` plugin setting, else `${CLAUDE_PLUGIN_DATA}/stripe-x/accounts.json`.

2. If no registry exists, create the directory and write a starter file, then `chmod 600` it:

   ```json
   {
     "default_account": "REPLACE_ME",
     "accounts": {
       "example-standalone": {
         "type": "standalone",
         "label": "Example business",
         "test_secret_key": "env:STRIPE_EXAMPLE_TEST",
         "live_secret_key": "op://Vault/StripeExample/live"
       },
       "example-connect": {
         "type": "connect",
         "label": "Example connected client",
         "platform": "example-standalone",
         "connected_account": "acct_REPLACE"
       }
     }
   }
   ```

3. The registry holds references, never secrets. `test_secret_key` accepts `op://Vault/Item/field` or `env:NAME`; `live_secret_key` accepts `op://Vault/Item/field` only. The engine refuses a plaintext secret and refuses `env:` for a live key at load time, regardless of file permissions. A Connect account carries no keys of its own, and no `op_account` of its own either; both are read from the `platform` account it names. Explain that `docs/` and the registry path are gitignored, and the file should still be `chmod 600`.

4. Add `op_account` to an account whenever its `op://` references should resolve against one specific signed-in 1Password account rather than whichever one `op` picks by default, naming that account's sign-in address (for example `acme-team.1password.com`). It is optional in the schema, but effectively required as soon as more than one 1Password account is signed in, since `op` cannot otherwise tell them apart and fails with "multiple accounts found". Worked example, two standalone accounts each pinned to a different 1Password account:

   ```json
   {
     "default_account": "acme",
     "accounts": {
       "acme": {
         "type": "standalone",
         "label": "Acme Inc",
         "test_secret_key": "op://Private/Stripe Acme/test_secret_key",
         "live_secret_key": "op://Private/Stripe Acme/live_secret_key",
         "op_account": "acme-team.1password.com"
       },
       "beta": {
         "type": "standalone",
         "label": "Beta Co",
         "test_secret_key": "env:STRIPE_BETA_TEST",
         "live_secret_key": "op://Private/Stripe Beta/live_secret_key",
         "op_account": "beta-team.1password.com"
       }
     }
   }
   ```

5. Provision the Stripe CLI by running `${CLAUDE_PLUGIN_ROOT}/scripts/install-stripe-cli.sh`.

6. Validate each configured account with a cheap test-mode read:
   `${CLAUDE_PLUGIN_ROOT}/bin/stripe-x balance retrieve --account <name>`
   Report which accounts pass. Never print secret key values; show only the last 4 characters.

7. Recommend also registering the permission-mode guard hook in the user's own `~/.claude/settings.json`, alongside the copy already registered in this plugin's `hooks/hooks.json`. `bin/stripe-x` stays on disk and directly callable from a terminal even if this plugin is later disabled, so the user-settings copy is what keeps guarding it regardless of plugin state. `~/.claude/settings.json` is not scoped to any plugin, so the `${CLAUDE_PLUGIN_ROOT}` placeholder will not expand there; resolve it to this installation's actual absolute path first, then merge the literal path into the existing file (do not overwrite it):

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash",
           "hooks": [
             {
               "type": "command",
               "command": "node \"/absolute/path/to/stripe-plugin/hooks/pretooluse-stripe-guard.js\"",
               "timeout": 10
             }
           ]
         }
       ]
     }
   }
   ```

   Double registration is harmless: two identical decisions are the same as one.

## Safety

Never write a key the user has not explicitly provided. Never echo full secret values back to the conversation.

Live operations also require a vetting token, on top of arming. Inside Claude Code the PreToolUse guard hook (step 7 above) issues one automatically for any stripe-x call it recognises and does not deny. A human working directly in a terminal, outside Claude Code, must run `stripe-x vet` first; it requires a real terminal (a TTY) and refuses otherwise, which is what stops an unattended agent from minting one for itself.
