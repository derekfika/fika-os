# Menu Planning — scoped agent guide

Root [AGENTS.md](../../AGENTS.md) applies. Menu Planning owns menu intent, dish catalogue, portions, destination allocations and publication. CPU owns materialised kitchen work; Logistics owns movement/dispatch; Delivered-In is a downstream consumer.

## Boundaries and contracts

- Preserve stable dish, OPLOC, publication and source IDs plus quantities/units. Resolve governed OPLOC redirects before service filtering. Do not generate portions or production for blank/no-service days.
- Publish immutable, versioned day/week evidence. Whole-week publication, amendment and withdrawal preserve optimistic concurrency, actor/source lineage and history. An intentionally blank published day is valid and distinct from missing/unpublished/withdrawn.
- Withdrawal is authoritative locally and must create durable downstream cancellation/invalidation even if delivery is pending. Preserve existing publication/outbox idempotency; a failed downstream request must not be reported as completed or silently dropped.
- Shared [weekly publication packets](../../packages/server-shared/src/weekly-publication-packet.ts), read packages and canonical production adapters feed CPU/Delivered-In. Validate the producer and directly affected consumers when changing schema, identity, quantities or invalidation.
- For packages/caches read detailed §§5.1–5.4: distinguish recoverable absence, stale and integrity failure; raw gzip hashes precede decompression. Provide historical/pre-migration compatibility, not only new-write support.

## UI and validation

- Root Style Guide applies to planner grids, publication controls, statuses and empty/blank states. Keep keyboard access, clear version/conflict errors and explicit publish/withdraw actions.
- Read package scripts. Run focused intent/publication/withdrawal/replay tests, affected typecheck/build, and isolated persistence tests when transactions change. Never run migration/cleanup write scripts as validation.
- Any material Menu → CPU → Delivered-In change must cover the [eight-case regression set (§8.1)](../../docs/ai/agent-reference.md): populated, deliberately blank, withdrawal, republish, OPLOC redirect, missing rebuildable package, corrupt package and stale-cache invalidation. Preserve Golden Week UAT tooling.

## Detailed references

- [Catalogue](docs/catalogue.md), [Firestore migration context](docs/FIRESTORE-MIGRATION-2A.md).
- [Read-package readiness](../../docs/deployment/menu-planning-read-package-readiness.md), [publication outbox](../../docs/deployment/menu-publication-outbox-scheduler.md).
- [Compiled-publication design evidence](../../docs/audits/2026-08-29/menu-planning-phase-5-compiled-publication-snapshot.md), [detailed domain/data rules](../../docs/ai/agent-reference.md).

Dated migration/audit reports are context, not authority to mutate live data or proof of current deployment/scheduler state.
