# Stage 7 Current Implementation Alignment — 2026-08-31

## Status and scope

This is a concise architecture-governance alignment record, not a full code audit. It records evidence reviewed in the FIKA OS monorepo against the accepted Stage 6 architecture and proposed [ADR-012](../decisions/ADR-012-materialised-read-packages-and-local-projection-caching.md). It does not authorise runtime changes, deployment, migration or data mutation.

## Overall assessment

The planned materialised read-package direction is aligned with the original architecture. ADR-007 already requires owned, derived, rebuildable projections with source linkage, freshness, completeness and reconciliation. ADR-012 is justified because the physical package publication, immutable versioning, manifest ordering, storage independence and local-cache contract were deliberately left open.

The live implementation is not uniformly drifted: several recent changes have moved toward bounded projections, cache scopes, manifest checks and read instrumentation. The principal issue is incomplete convergence. Some paths still reconstruct cross-domain views or read broad canonical datasets, while existing projections/caches do not consistently expose package-level lineage, completeness, immutable publication and reconciliation metadata.

## Areas reviewed and classification

| Area | Evidence reviewed | Classification | Alignment / drift |
|---|---|---|---|
| Integration Hub | `lib/integration-cache-server.ts`, `integration-cache-shared.ts`, `authmod-admission-cache.ts`, `authmod-reference-cache.ts`, `lib/manifest.ts`, cache/API tests | ALIGNED with IMPLEMENTATION GAP | Dataset manifests, bounded caches, invalidation and access metering exist. Dataset reads still query canonical records directly; package immutability, content objects, completeness and rebuild/reconciliation are not a shared contract. |
| Menu Planning | `catalogue-manifest.ts`, `menu-catalogue-cache.ts`, `firestore-operational-store.ts`, publication routes, read-path tests | ALIGNED with MATERIAL DRIFT / IMPLEMENTATION GAP | Version-based manifest comparison, compiled publication snapshots and identity-scoped IndexedDB are strong ADR-007 direction. The `__manifest__` reserved-document path is a correctness/deployment blocker to resolve before Phase 2; the current manifest is not yet an immutable package publication contract. |
| Delivered-In | `projection.ts`, `production-client.ts`, site-menu stores and read-budget tests | MINOR DRIFT / IMPLEMENTATION GAP | Published-menu projection preserves source IDs, versions, hashes and allergen evidence. Production materialisation remains a synchronous app-to-app seam, and the projection/cache boundary lacks a complete package freshness/completeness/reconciliation contract. |
| CPU Production | `cpu-projection.ts`, `cpu-projection-repository.ts`, `cpu-indexeddb.ts`, published-menu selection and projection tests | ALIGNED with IMPLEMENTATION GAP | Service-date/week projections, revision/change sequence and non-authoritative IndexedDB cache are present. Package publication is mutable Firestore projection state rather than an immutable, manifest-advertised read package; source/package divergence and rebuild health are not fully represented. |
| Logistics | `projection-dashboard-adapter.ts`, `incremental-sync.ts`, `logistics-cache.ts`, planner/read-budget tests | ALIGNED with PERFORMANCE/READ-MODEL DRIFT | Projection/dashboard separation, bounded incremental reads and scoped client cache exist. The service-day view still depends on assembled upstream inputs in places, and cache records do not carry the full package lineage/freshness/completeness contract. |
| Hospitality | current-system map and hospitality implementation inventory; booking/dashboard/provider paths | MATERIAL DRIFT / IMPLEMENTATION GAP | Accepted architecture classifies dashboard Sheets, Calendar, documents and provider records as projections/adapters, but the current family still has legacy reconstruction and mixed operational stores. Durable canonical booking repository/version delivery and shared projection ownership remain unresolved. |
| AUTHMOD | `authmod-core`, `authmod-admission-cache.ts`, reference cache, session and access tests | ALIGNED with MINOR DRIFT | Server-side enforcement and fail-closed admission are preserved; short-lived cache/in-flight deduplication and invalidation reduce repeated evaluation. Caches are TTL/generation based rather than consistently source-version/access-version aware, so they should not be expanded into a browser permissions bundle. |
| Shared tracing/cache infrastructure | `packages/server-shared`, data-source meter usage across apps, trace tests | ALIGNED with IMPLEMENTATION GAP | Source/cache attribution and read-budget tests make optimisation measurable. Attribution is not yet consistently separated into canonical read, application cache, package retrieval and client cache for all paths; tracing reliability remains a Phase 0 concern. |

## Drift by concern

### Correctness and security drift

- The Menu Planning reserved `__manifest__` path is an explicit correctness blocker in the current implementation direction and must be resolved before package rollout.
- AUTHMOD caches must remain server-authoritative, fail closed and invalidated on relevant authority/access-version changes. Current TTL/generation caches support this boundary but do not prove version-aware revocation semantics.
- Client IndexedDB caches are appropriately treated as non-authoritative in the reviewed CPU, Logistics and Menu Planning code; access-scope isolation must remain mandatory as new packages are added.
- Hospitality legacy access, provider identity and dashboard allowlists remain implementation controls, not canonical authority under ADR-008.

### Performance and read-model drift

- Integration Hub and some operational paths still read or reconstruct granular canonical data where a governed package/projection could serve the read purpose.
- Delivered-In and parts of Logistics still synchronously assemble cross-domain operational state, increasing fan-out and coupling even where projection adapters exist.
- Existing projections often have revision or timestamp fields, but not a consistent package-level declaration of source versions, hash, completeness, freshness class and rebuildability.
- Recent read-budget and cache work is evidence-led and directionally aligned; it is not a substitute for the package publication contract.

### Documentation and governance drift

- Stage 7 is correctly marked active and records the original Shadow CPU increment plus later UAT implementation, but the accepted documentation did not yet record the physical read-package strategy now being selected for implementation.
- `docs/current-system-map.md` remains accurate in identifying several canonical repositories and owners as TODO; the live repository has advanced further in some projection/cache mechanics without a corresponding architecture decision.
- No conclusion here claims that every application or every route has been audited.

## Immediate corrective direction

1. Resolve Phase 0 deployment/correctness and tracing blockers.
2. Accept and implement the shared package/manifest mechanics only after named projection owners and access classifications are confirmed.
3. Start with measured Menu Planning catalogue/publication read cost, then move downstream to Delivered-In and reference packages.
4. Keep authoritative queries at decisions and protected boundaries; use packages for declared read purposes only.
5. Add package lineage, freshness, completeness, corruption/fallback and reconciliation evidence to each adopted projection.

## Intentionally deferred

- Exact storage/object provider, compression and serialisation.
- Universal freshness, retention, deletion and restatement targets.
- New canonical schemas or business meaning.
- Final ownership of hospitality projection, reporting and future Logistics domain records where current governance still says TODO.
- Delta packages, browser-trusted permission bundles and platform-wide rewrite.

## Recommended implementation sequence

See the sequence in [ADR-012](../decisions/ADR-012-materialised-read-packages-and-local-projection-caching.md#recommended-implementation-sequence): Phase 0 blockers; shared mechanics; Menu Planning; Delivered-In; Integration Hub reference packages; CPU/Logistics optimisation. AUTHMOD proceeds as a separate complementary server-authoritative access-context track.

## Reviewed paths

The review covered the named application areas above, relevant shared tracing/cache code, current-system and performance documentation, Stage 7 records, and ADR-001/005–011. It was deliberately targeted and did not inspect every file, route, fixture or deployment path.
