# stripe plugin - AI agent context

## What this plugin does

Full programmatic access to every Stripe API endpoint the pinned stripe-node SDK exposes, across many accounts (standalone keys and Connect), replacing the single-account MCP connector. The engine binary owns operation-level enforcement (classification, confirmation, arming, fan-out refusal, bulk scope review). It cannot defend against a caller that writes its own flags, so a PreToolUse hook in `hooks/` owns the permission-mode boundary; the engine additionally requires a live operation to carry a vetting token (`src/vetting.js`, exit code 15) that only that hook (or a human running `stripe-x vet` from a real terminal) can issue, so an invocation the guard never recognised is refused rather than executed. Both share `src/classify.js`, so a new money-mover added to the frozen DESTRUCTIVE list teaches both gates at once.

## Layout rules

Component dirs at plugin root. Only the manifest in .claude-plugin/. All internal references use ${CLAUDE_PLUGIN_ROOT} or ${CLAUDE_PLUGIN_DATA}. docs/ is local-only and gitignored.

## When extending

The dispatcher is reflective; never add per-endpoint code. To track new Stripe endpoints, bump the stripe dependency, re-run npm run gen-api-map, update CHANGELOG with the new pinned API version from node_modules/stripe/cjs/apiVersion.js. When bumping the stripe dependency, also re-probe method arities (instance ops should be fn.length>=3, collection/singleton<=2) since src/dispatch.js's missing-id guard depends on that; it fails safe (clean error, never a silent malformed call) but a silent arity change should be caught at bump time.

Safety classification is action-name plus the frozen DESTRUCTIVE override list in src/classify.js. Adding a money-mover means adding it there with a test.

## Validation

node --test test/*.test.js and claude plugin validate . must both pass before any tag.
