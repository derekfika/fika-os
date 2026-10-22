# Hospitality — scoped agent guide

Root [AGENTS.md](../../AGENTS.md) applies. Hospitality owns customer/staff booking authoring, presentation, commercial workflow and explicit handoff intent. Hub provides the authoritative catalogue, booking validation/persistence and canonical production commands; CPU owns accepted kitchen work.

## Boundaries and contracts

- Preserve all supported portals and staff standalone/group flows. Inspect [surface boundaries](docs/ui-surface-boundary.md) before changing shared versus site-specific UI; avoid leaking one site's presentation/business rules to another.
- Consume governed catalogue packages through the shared resolver/client, not local menu fixtures as production truth or browser Firestore scans. Canonical Item IDs, sparse site exceptions, price effective dates, minimums, availability and quote-only/configuration rules must survive projections. Historical bookings retain their commercial snapshots.
- Use the shared [booking-date policy](../../packages/server-shared/src/hospitality-booking-cutoffs.ts) for empty baskets, selections and amendments; the Hub independently enforces it. Preserve longer product/event/site rules, UK noon/DST handling and permitted historical retries. Do not duplicate policy in a calendar component.
- Grouped services retain distinct child booking/quote/Production Order identities. Preserve totals/VAT, optimistic versions, partial-success retries and canonical CPU eligibility. Explicit No CPU excludes production; unresolved routing is not No CPU. A UI handoff label must not imply kitchen completion.
- Preserve governed site Drive ownership/destinations, matrix lifecycle and immutable quote/run-sheet lineage. Cancellation retains audit/signed evidence and exposes pending/manual CPU review; retries do not duplicate handoffs or customer emails. Keep approved site/recipient restrictions and historical email exclusions.

## UI and validation

- Read the root Style Guide and surface-boundary document for a button/layout change; architecture references are needed only when their boundaries change. Keep accessible date explanations, focus/keyboard behaviour, responsive controls and existing reset/draft confirmations.
- Run focused portal/group/amendment/cancellation/quote tests for changed behaviour, then affected typecheck/build per package scripts. Shared rule/contract changes also require Hub tests, including actual isolated-emulator server rejection/concurrency coverage when persistence is affected.
- Use verified mobile viewport measurements for responsive claims. Use a genuinely isolated context for cold-cache claims. No real customer bookings, emails or CPU/Logistics side effects during UAT without separate approval.

## Detailed references

- [Universal notice](../../docs/deployment/universal-booking-notice-2026-10-20.md), [RCoA mapping](docs/rcoa-hospitality-mapping.md), [Gallagher dashboard](docs/gallagher-dashboard.md).
- [Sparse catalogue](../integration-hub/docs/hospitality-catalogue-sparse-model.md), [public package/cache](../../docs/deployment/hospitality-public-catalogue.md).
- [Group amendments](../../docs/architecture/hospitality-group-amendment-lifecycle.md), [matrix storage](../../docs/architecture/hospitality-site-matrix-drive.md), [cancellation/email integration](../../docs/deployment/hospitality-cancellation-email-integration-2026-10-19.md).
- [Detailed safety rules](../../docs/ai/agent-reference.md). The local README and older integration reports describe earlier phases; verify current producers/consumers before relying on them.
