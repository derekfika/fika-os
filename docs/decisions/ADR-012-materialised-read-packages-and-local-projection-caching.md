# ADR-012: Materialised Read Packages and Local Projection Caching

- Status: Proposed
- Date: 2026-08-31
- Stage: Stage 7 — Implementation Architecture
- Decision owners: Platform Governance, constrained by participating domains' approved business authority
- Depends on: ADR-001 and ADR-005 through ADR-011
- Supersedes: none

## Context

[ADR-007](ADR-007-projection-and-dashboard-boundary.md) establishes projections as owned, derived, rebuildable and non-authoritative, but deliberately leaves their physical publication, storage, retention and delivery mechanism open. Current implementation evidence shows that several applications are beginning to implement this boundary while still reconstructing some read models from granular Firestore records or synchronous application calls. Menu Planning, Integration Hub, CPU Production and Logistics already contain partial manifests, projections, caches and read-budget instrumentation, but these are not yet one governed physical contract.

Firestore usage evidence has identified repeated retrieval of substantially unchanged catalogue, reference, authority and operational data. A shared physical strategy is therefore needed before further optimisation work selects incompatible package and cache conventions. This ADR records that strategy without changing canonical business meaning, schemas or domain ownership.

## Evidence considered

| Evidence | Relevant conclusion | Authority |
|---|---|---|
| [ADR-007](ADR-007-projection-and-dashboard-boundary.md) | Projections need explicit ownership, source linkage, freshness, completeness, checkpoints, rebuild and reconciliation; snapshot mechanism remains unselected. | Accepted architecture |
| [ADR-005](ADR-005-domain-event-and-integration-contract.md) | Events communicate completed facts and must remain minimised, duplicate-safe and replayable. | Accepted architecture |
| [ADR-006](ADR-006-repository-and-consistency-contract.md) | Canonical repositories own persistence and consistency; projection failure must not reverse canonical change. | Accepted architecture |
| [ADR-008](ADR-008-identity-and-authmod-enforcement-boundary.md) | AUTHMOD remains authoritative at protected boundaries; cache design cannot turn authentication or stale decisions into authority. | Accepted architecture |
| [Platform principles](../platform-principles.md) and [target architecture](../target-architecture.md) | Source-of-truth clarity, storage independence, measured optimisation and gradual migration are required. | Canonical architecture |
| [Current implementation alignment](../stages/stage-7-current-implementation-alignment-2026-08-31.md) | Current applications contain partial projections and caches alongside materialised-view drift and incomplete package metadata. | Current-state evidence |

## Decision

FIKA OS will implement materialised read packages as a physical implementation of governed projections. A read package is a versioned, derived representation prepared for a declared consumer and scope. It exists to reduce repeated retrieval, oversized cross-domain reconstruction and repeated computation of substantially unchanged read models. It is not a canonical record, business command surface or replacement for an authoritative domain query.

### Authority and ownership

- Canonical domain repositories remain authoritative for business state, invariants, lifecycle, history and mutation.
- A package is disposable and rebuildable to the extent declared by its projection contract. It cannot accept canonical mutation or become a competing source through convenience.
- Every package has one logical owner accountable for its definition, source contract, access policy, freshness, completeness, reconciliation, rebuild and retirement.
- Shared infrastructure may provide package, manifest, hashing, transport, cache and instrumentation mechanics. It must not become a universal projection store or own domain meaning. FIKA Core and Integration Hub must not become universal owners merely because they provide shared mechanics or reference access.

Candidate ownership examples are Menu Planning for published-menu projections, Delivered-In for its site/day view, CPU Production for its operational projection, Logistics for a service-day view, and Integration Hub for governed reference-data projections. These examples do not approve new domain ownership or business policy.

### Package contract

A package contract declares, as applicable:

- projection/package identity and logical owner;
- schema or contract version;
- source identifiers and source versions;
- generated time and effective/as-of point;
- content hash or checksum;
- completeness and freshness;
- rebuildability and recovery information;
- access classification and scope;
- predecessor or base version when deltas are supported.

Exact field names and serialisation are implementation choices unless separately governed. Stable canonical IDs remain the identity carried inside packages; display text is never a join key.

### Manifest and publication

A small manifest may advertise the currently published package for a declared scope. It may contain package version, hash, object reference, generated time, source version, bounded diagnostics, item count and compatibility metadata. It is metadata, not canonical business state or a client trust signal.

Publication is consumer-atomic: build, validate and durably persist the package before publishing its manifest/reference. A new manifest must not become visible before its corresponding package is available. Published package versions are immutable; changed source state produces a new version. A failed build leaves the prior valid package available and does not invalidate an accepted canonical change.

### Events, authoritative reads and deltas

ADR-005 remains unchanged. Domain and integration events communicate completed facts and should not become giant data-transfer blobs. An event may trigger or announce a package rebuild and may carry stable version, hash or reference metadata where appropriate. Large read-optimised representations belong in packages.

Packages support visibility, navigation, filtering, search, planning, dashboards, operational coordination and read-heavy reference data when their declared freshness and completeness are suitable. Where a decision materially depends on current canonical state, the owning domain supplies an authoritative query and the protected boundary revalidates it.

Deltas are optional. They may be used only with explicit lineage, enforceable ordering/version rules, recovery to a trusted full package, and fail-closed handling of missing, corrupt or out-of-order updates. Version 1 does not require deltas.

### Client-local cache

IndexedDB and other browser persistence are read caches only. They must not bypass server-side authorisation, become canonical recovery, or be trusted as current AUTHMOD authority. Where visibility differs, cache keys are scoped to the user/account/access context; material access-context changes invalidate or replace affected entries. Version/hash comparison is preferred to blind TTL alone where practical. Cache loss and corruption must be survivable through server/package recovery.

### Security and AUTHMOD

Package access follows the data-access boundary of the projection. Client possession of a package is not current authority. Sensitive projections may require identity-aware delivery, per-scope packages, signed/time-bounded access or access-version invalidation; this ADR selects no provider mechanism. AUTHMOD remains authoritative at protected boundaries, and evaluated access caching must be short-lived or version-aware, explicitly invalidated, fail closed when authority is uncertain, and separate from session validity.

### Failure, rebuild, reconciliation and observability

Each package contract defines rebuild inputs, freshness observation, incomplete-generation representation, corruption rejection, consumer fallback and source/package reconciliation. A stale or incomplete package is labelled as such and is never silently described as authoritative current state. A consumer has a defined fallback to a full package or authoritative query according to the projection's risk.

Read instrumentation should distinguish canonical domain/Firestore reads, server memory cache, application cache, package/object retrieval and client-local cache. Where practical, Usage Observatory attributes these separately. Monitoring remains evidence for optimisation, not business state.

### Storage independence and migration

Cloud Storage, Firestore, IndexedDB, compression, serialisation and App Hosting topology are implementation selections, not business meaning. They may change without redefining a projection contract. Adoption is incremental and prioritised by measured read cost, architectural leverage and risk. Existing paths may coexist temporarily when authority direction, fallback, reconciliation and retirement criteria are explicit.

## Consequences

### Positive consequences

- Read-heavy consumers can avoid repeated reconstruction while retaining canonical authority.
- Projection lineage, freshness and completeness become visible and testable.
- Browser caches can improve cold/warm performance without becoming a permission or recovery dependency.
- Package mechanics can be shared without creating a central business-data owner.
- Migration can proceed by measured candidate rather than platform-wide rewrite.

### Trade-offs and risks

- Each projection needs an owner, rebuild path, access classification and reconciliation evidence.
- Immutable versions consume storage and require retention decisions that remain domain-specific.
- Stale, partial and corrupt packages add operational states that consumers must represent.
- Cross-domain packages need careful minimisation and source-version handling.
- A manifest or cache can reduce reads only if publication and invalidation correctness are maintained.

## Explicit non-decisions

This ADR does not decide:

- canonical domain ownership, business meaning, schemas or lifecycle policy;
- exact package field names, serialisation, compression, database, object store or hosting topology;
- universal freshness, retention/deletion or restatement targets;
- whether a particular application or dataset must adopt a package;
- an AUTHMOD permission bundle trusted by a browser;
- a provider, signed-URL product, event broker or deployment arrangement;
- a mandatory delta format or event-sourcing architecture.

## Recommended implementation sequence

1. **Phase 0 — correctness and deployment blockers:** ensure the current Menu Planning revision is deployable, resolve the reserved `__manifest__` correctness issue, and restore reliable tracing.
2. **Phase 1 — shared mechanics:** define package/manifest/checksum/version/freshness utilities and instrumentation without assigning domain ownership.
3. **Phase 2 — Menu Planning:** materialise canonical catalogue and published-menu packages, then add identity-scoped IndexedDB caching.
4. **Phase 3 — Delivered-In:** build operational site/day projections from published-menu, CPU and governed reference inputs.
5. **Phase 4 — Integration Hub:** package OPLOCs and other stable reference datasets where access semantics permit.
6. **Phase 5 — CPU and Logistics:** optimise production and service-day projections using measured cost and validated reconciliation.

AUTHMOD remains a complementary track: server-authoritative evaluated access context, short-lived/version-aware caching and explicit invalidation, with no browser-trusted permissions bundle.

## Required follow-up

Before implementation promotes this contract from Proposed to Accepted, governance should confirm the package-manifest contract, named first projection owners, retention policy ownership and the Phase 0 correctness findings. No business decision or schema change is required by this ADR.

## Validation notes

This ADR was prepared against ADR-001 and ADR-005 through ADR-011, the platform principles, target architecture, documentation governance, Stage 7 records and the current implementation alignment register. It changes no BDR Decision, schema, fixture, runtime application code, production data or infrastructure configuration.
