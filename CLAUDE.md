# stripe plugin - AI agent context

## What this plugin does

Full programmatic access to every Stripe API endpoint the pinned stripe-node SDK exposes, across many accounts (standalone keys and Connect), replacing the single-account MCP connector. The engine binary owns operation-level enforcement (classification, confirmation, arming, fan-out refusal, bulk scope review). It cannot defend against a caller that writes its own flags, so a PreToolUse hook in `hooks/` owns the permission-mode boundary; the engine additionally requires a live operation to carry a vetting token for that exact operation (`src/vetting.js`, exit code 15) that only that hook (or a human running `stripe-x vet <resource> <action> --live` from a real terminal) can issue. Both share `src/classify.js`, and the CLI bridge's own read list lives in `src/cli_bridge.js`, so a new money-mover added to either frozen list teaches both gates at once.

The vetting token is bound to the call, not to the session. `canonicalKey()` in src/vetting.js is the single definition of "which operation is this" (account, registry path, camelized resource, action, live flag, arm flag, target id, bulk ids), computed independently by the guard from its parse and by the engine from its argv. Live arming and the `stripe-x cli` bridge are gated on it too, so there is no path to a live key that skips it. Where the two sides disagree the engine refuses, so divergence costs a false refusal and never a false authorisation.

RESIDUALS, do not describe this layer as stronger than it is. The target is bound through `--id` and `--bulk-ids` but NOT through `--data`, because the engine's parsed data object cannot be reconstructed into text the guard would compute identically; so for an operation targeted via --data (refunds create --data charge=ch_1) a warm token still authorises the same operation on a different target within the TTL. The `stripe-x vet` TTY check is a presence heuristic, not proof of a human. See docs/SESSION-HANDOFF-2026-08-02b.md (local-only, `docs/` is gitignored) for the current state and open work.

## Layout rules

Component dirs at plugin root. Only the manifest in .claude-plugin/. All internal references use ${CLAUDE_PLUGIN_ROOT} or ${CLAUDE_PLUGIN_DATA}. docs/ is local-only and gitignored.

## When extending

The dispatcher is reflective; never add per-endpoint code. To track new Stripe endpoints, bump the stripe dependency, re-run npm run gen-api-map, update CHANGELOG with the new pinned API version from node_modules/stripe/cjs/apiVersion.js. When bumping the stripe dependency, also re-probe method arities (instance ops should be fn.length>=3, collection/singleton<=2) since src/dispatch.js's missing-id guard depends on that; it fails safe (clean error, never a silent malformed call) but a silent arity change should be caught at bump time.

Safety classification is action-name plus the frozen DESTRUCTIVE override list in src/classify.js. Adding a money-mover means adding it there with a test.

## Releasing

A version lives in exactly two files, `.claude-plugin/plugin.json` and `package.json`, and they must match. Nothing else may hold a copy: `src/mcp_shim_server.js` reads the manifest, and `test/manifest.test.js` fails if a quoted version literal reappears or the two manifests diverge. Move the CHANGELOG's `## Unreleased` content under a `## <version> - <date>` heading in the same commit; a released version with no CHANGELOG section fails the same test file.

Tag only after a bump. Version bumps, tags and deploys are separate, individually gated acts, and a tag without a bump is a meaningless ref.

## Validation

node --test test/*.test.js and claude plugin validate . must both pass before any tag.
