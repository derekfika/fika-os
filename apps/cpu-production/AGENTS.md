# CPU Production — scoped agent guide

Root [AGENTS.md](../../AGENTS.md) applies. CPU owns operational production planning/state after accepted canonical handoff, reviewed allergen matrices and signed operational releases. It does not own upstream booking prices/menu intent or downstream dispatch state.

## Safety and persistence boundaries

- Before changing plans, review/signing, quantities, materialisation or persistence, read [detailed rules §§3–6 and 8](../../docs/ai/agent-reference.md) and the logging/audit strategy linked at root. Use canonical Production Orders, stable source/dish/OPLOC IDs, correct portions/units and destination allocations. Never invent work for intentionally blank publications.
- UNRECORDED is not CLEAR. Positive/may-contain/unknown evidence must survive review. Signing needs complete, successfully persisted evidence; signatures/releases bind to the exact frozen matrix and source lineage. A save failure, stale version or in-flight edit cannot unlock signing.
- Any post-signing allergen amendment revokes current release/signatures, PDF/packet artifacts and downstream current pointers; re-review and dual signatures are required. Preserve immutable historical artifacts/audit evidence. No validation relaxation to make a fixture pass.
- Preserve central repository revision/concurrency enforcement for every mutation, including materialisation/background/outbox callers. Callers must adopt the saved revision; idempotent/no-op retries must not conceal changes or invalidate good signatures unnecessarily.
- CPU persistence precedes Hub lifecycle synchronisation. Pending/failed downstream state stays durable and visible; retry/recovery must be idempotent. Do not silently replace missing/cancelled/newer Hub state with assumed synchronisation.
- Distinguish missing derived packages from integrity failures. Rebuild absence only from valid canonical authority with bounded/coalesced recovery and historical compatibility; corruption fails closed. Preserve raw compressed-byte hashes and verified current release/PDF access.
- Use shared packets/outbox/production contracts for Hub, Menu Planning, Delivered-In and Logistics. Delivered-In consumes the current verified compressed packet, not revoked history. Do not weaken AUTHMOD/site checks to expose signed PDFs.

## UI and validation

- Root Style Guide applies to tablet navigation, calendars, review and signature controls. UI-only work must not alter production quantities, approval state or safety semantics.
- Read package scripts. Focus tests on plan revisions, concurrency, signing lineage, release/PDF readiness and durable-outbox/replay boundaries changed. Use isolated stores; local/CI tests may use the existing `FIKA_CPU_PLAN_STORE=memory` mechanism, never production as a fixture.
- When persistence changes, test the real route/repository transaction and rejected-write side effects, not helpers alone. Validate affected packet consumers and the Menu → CPU → Delivered-In regression set (§8.1). Compare suspected CRLF/baseline failures before dismissing them; run affected typecheck/build.
- Outbox worker/scheduler recovery is separately operated. App Hosting does not imply a running worker; do not enable recovery schedulers without authority.

## Detailed references

- [Shared publication packet](../../packages/server-shared/src/weekly-publication-packet.ts), [signed OPLOC bundle](../../packages/server-shared/src/daily-signed-oploc-bundle.ts), [shared durable outbox](../../packages/server-shared/src/durable-outbox.ts).
- [CPU outbox recovery](../../docs/deployment/cpu-durable-outbox-scheduler.md), [Hospitality CPU integration](../../docs/architecture/hospitality-uat-integration.md), [launch UAT context](../../docs/uat/hospitality-cpu-launch-2026-10-06.md).

Dated rollout/UAT reports are evidence to compare against current code and serving source, not a blanket claim of current readiness.
