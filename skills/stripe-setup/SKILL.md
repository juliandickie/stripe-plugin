---
name: stripe-setup
description: Set up the stripe plugin. Use when the user asks to (1) configure Stripe accounts, (2) add or change Stripe API keys, (3) install the Stripe CLI, or (4) verify Stripe connectivity. Scaffolds the multi-account registry and provisions the bundled Stripe CLI.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash Read Write
---

# Stripe Setup

Configure the multi-account registry and provision the Stripe CLI. This skill is user-invoked only because it writes credential configuration.

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

3. Test keys may use `env:VAR_NAME` indirection. Live keys must be a 1Password reference (`op://Vault/Item/field`): the engine refuses a plaintext secret and refuses `env:` for a live key at load time, regardless of file permissions. Explain that `docs/` and the registry path are gitignored, and the file should still be `chmod 600`.

4. Provision the Stripe CLI by running `${CLAUDE_PLUGIN_ROOT}/scripts/install-stripe-cli.sh`.

5. Validate each configured account with a cheap test-mode read:
   `${CLAUDE_PLUGIN_ROOT}/bin/stripe-x balance retrieve --account <name>`
   Report which accounts pass. Never print secret key values; show only the last 4 characters.

## Safety

Never write a key the user has not explicitly provided. Never echo full secret values back to the conversation.
