<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Delivered-In — scoped FIKA OS guide

Root [AGENTS.md](../../AGENTS.md) and the generated Next.js guidance above apply. Delivered-In owns site-facing presentation, local request authoring and derived menus; it is a consumer, never a second menu/production/logistics authority.

## Boundaries and contracts

- Consume governed Menu/CPU/Logistics truth through existing adapters and shared contracts. Preserve stable OPLOC/source IDs, authorised site scope, actual destination allocations and quantity units; no name-based joins or invented production.
- Preserve week/day navigation and populated, deliberately blank, missing, unavailable and withdrawn states. Do not hide a valid blank publication because its entries are empty.
- Operational allergens come only from the current verified compressed CPU packet. Revoked historical releases remain evidence, not current truth. Preserve source/version/signature checks and root post-signing invalidation rules.
- IndexedDB/process caches validate schema, hash, version and freshness; invalidate withdrawn/stale current pointers. Distinguish rebuildable absence from integrity failure and never silently present stale safety data as current. Read detailed §§5.1–5.4 before package/cache changes.
- Preserve production/staging upstream allowlists and effective configuration. Every credential-bearing request (session, internal token, Google bearer) must retain its existing destination guard and `redirect: 'error'`; never forward credentials/body via redirects or log credentials. Browser cookie isolation is a separate boundary, not permission to weaken server routing.
- Grab & Go uses governed catalogue/OPLOC eligibility and the canonical request → Production Order path. Do not invent a parallel standing-order/service-enablement authority or activate unfinished generators/schedulers.

## UI and validation

- Root Style Guide applies to site menus, ordering and status/empty-state UI. Keep unavailable/withdrawn explanations actionable and keyboard navigation accessible.
- Read package scripts. Run focused projection/cache/credential-forwarding tests plus affected typecheck/build; cross-app changes include provider and consumer tests. Cover the Menu → CPU → Delivered-In eight-case set in detailed §8.1 when materially affected.
- Prove a browser context is isolated before claiming cold-cache validation; check cache refresh and withdrawal. Never create real orders, PDFs, customer artifacts or notifications merely to test UI.

## Detailed references

- [Shared packets](../../packages/server-shared/src/weekly-publication-packet.ts), [signed OPLOC bundles](../../packages/server-shared/src/daily-signed-oploc-bundle.ts), [credentialed upstream adapter](../../packages/server-shared/src/credentialed-upstream.ts).
- [Delivered-In read-path audit context](../../docs/audits/2026-08-29/06-delivered-in-remaining-read-paths.md), [Grab & Go catalogue](../../docs/deployment/grab-and-go-catalogue.md), [detailed safety rules](../../docs/ai/agent-reference.md).

The local README contains earlier-phase auth/storage descriptions: verify current code; synthetic local fixtures are never production authority. Preserve the generated block above verbatim.
