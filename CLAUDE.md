# stripe plugin - AI agent context

## What this plugin does

Full programmatic access to every Stripe API endpoint the pinned stripe-node SDK exposes, across many accounts (standalone keys and Connect), replacing the single-account MCP connector. The engine binary owns all safety enforcement.

## Layout rules

Component dirs at plugin root. Only the manifest in .claude-plugin/. All internal references use ${CLAUDE_PLUGIN_ROOT} or ${CLAUDE_PLUGIN_DATA}. docs/ is local-only and gitignored.

## When extending

The dispatcher is reflective; never add per-endpoint code. To track new Stripe endpoints, bump the stripe dependency, re-run npm run gen-api-map, update CHANGELOG with the new pinned API version from node_modules/stripe/cjs/apiVersion.js.

Safety classification is action-name plus the frozen DESTRUCTIVE override list in src/classify.js. Adding a money-mover means adding it there with a test.

## Validation

node --test test/*.test.js and claude plugin validate . must both pass before any tag.
