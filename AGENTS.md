FIKA OS — Agent Operating Guide

This file is the repository-wide operating guide for AI coding and review agents working on FIKA OS.

It is intentionally a map and a set of invariants, not a complete description of every implementation detail. Inspect the current code before making claims or changes. More-specific AGENTS.md files lower in the tree are additive and take precedence for their directory scope.

Important: `apps/delivered-in/AGENTS.md` contains Next.js-generated agent guidance. Preserve it and obey it when working in that app. Do not replace or remove the generated block.

==================================================
CANONICAL SOURCE CONTROL — NON-NEGOTIABLE
==================================================

Canonical local repository:
C:\FIKA

Canonical branch:
main

Canonical remote source for new work:
origin/main

1. `main` is the only canonical branch.
2. Before any read/write task, fetch origin and record the current `origin/main` SHA.
3. Normal single-thread work is performed directly on `main` after `git pull --ff-only origin main`.
4. NEVER create another local clone such as `C:\FIKA-UAT`, `C:\FIKA-feature-*`, `C:\FIKA-thread-*` or similar.
5. NEVER create Git worktrees for FIKA OS development.
6. Never rebase published `main`, force-push `main`, or rewrite canonical history.
7. Never treat an old UAT/refactor branch as authoritative merely because it contains newer-looking code.
8. Push `main` after successful validated work unless the user explicitly says not to push.
9. Treat `main` as protected even if GitHub branch protection is not currently enforcing it. Never push unvalidated work simply because the remote allows it.

Temporary task branches are allowed ONLY when the user or coordinator explicitly requests a parallel implementation wave. In that case:

- each task branch must be created fresh from the same recorded `origin/main` baseline;
- do not branch one task from another task branch;
- keep scopes/file ownership disjoint;
- do not deploy from a temporary task branch;
- return the branch name, starting SHA and final SHA;
- integrate completed work sequentially back into `main` after review;
- delete/retire temporary branches after integration when appropriate.

==================================================
MANDATORY CHANGELOG RULE
==================================================

EVERY Codex task operating on this repository must update the root `CHANGELOG.md` before returning. This includes code, configuration, documentation, architecture, bug-fix, refactor, migration and forensic tasks. The only exception is an explicitly read-only task.

Each entry records:

- date;
- task/thread title;
- concise summary;
- affected app/domain;
- validation/tests;
- deployment status.

Never fabricate a deployment.

==================================================
MANDATORY CODEX RETURN FORMAT
==================================================

Every Codex task return must end with:

- Thread/task name
- Branch
- Starting `origin/main` SHA
- Final SHA
- Push status
- CHANGELOG updated: yes/no + entry title
- Tests/typechecks/builds performed
- Deployment status
- TL;DR

If no implementation change was needed, say so explicitly.

==================================================
1. WHAT FIKA OS IS
==================================================

FIKA OS is one operational platform made up of several applications and entry routes.

Core principle:

Different entry routes. One downstream operational truth.

Hospitality, Menu Planning, Grab & Go, Ad-Hoc Production and other workflows may begin differently, but once work reaches Production and Fulfilment it must use shared canonical contracts rather than inventing parallel operational domains.

The platform evolves quickly. Do not assume an old README, audit or legacy folder describes the current architecture. Inspect current code, current schemas and current runtime paths.

Useful repository context:

FIKA-OS-DEVELOPMENT-HISTORY.md — project evolution and architectural intent.
COST-EFFICIENCY.md — standing performance and metered-service guardrails.
LOCAL-WORKSPACE.md — local supervisor, ports and emulator workflow.
CHANGELOG.md — recent notable changes.
docs/ai/LOGGING-AUDIT-STRATEGY.md — mandatory platform rules for business audit evidence, technical diagnostics and archival.
docs/ai/CODEBASE-AUDIT-PROTOCOL.md — mandatory process for a formal whole-codebase audit.

==================================================
2. CURRENT PLATFORM AREAS
==================================================

Treat these as parts of one platform, not independent greenfield apps:

Integration Hub
Hospitality Booking / Hospitality Manager
CPU Production
Menu Planning
Delivered-In
Grab & Go
Logistics
Events Dashboard
Beverage Innovation
Ad-Hoc Production
FIKA OS launcher / local supervisor tooling
shared domain and fulfilment contracts

Legacy sites/content and older scripts may remain for compatibility, migration or recovery. Do not remove or rewrite legacy paths merely because a newer app exists. Establish whether they are still operational first.

==================================================
3. ARCHITECTURE INVARIANTS
==================================================

3.1 Canonical downstream flow

Prefer this model unless current code proves a deliberate exception:

entry workflow
↓
owned domain object / request
↓
explicit handoff
↓
canonical Production Order
↓
Fulfilment Requirement
↓
Logistics / downstream operational projections

Do not create a second Production, Fulfilment or Logistics truth for a new upstream workflow.

3.2 Domain ownership

Each application owns the information it is responsible for and hands off explicitly at domain boundaries.

Examples:
- Hospitality owns booking authoring/commercial workflow before CPU handoff.
- Menu Planning owns menu intent, portions/destinations and publication before production materialisation.
- Ad-Hoc Production owns request/quote/menu/allergen authoring before Send to CPU.
- CPU owns operational production state after accepted handoff.
- Logistics owns planning, assignment, movement and dispatch state.
- Delivered-In is primarily a site-facing projection/consumer, not a second logistics or production authority.

Do not silently mutate another domain's authoritative record from a UI convenience path.

3.3 Stable identity

Stable IDs are identity.

Never use display text, customer name, dish title, address label or other human-readable text as record identity when a stable ID exists or can be created.

Avoid name-based joins between applications.

Preserve IDs across projections, amendments and handoffs so the same occurrence can be traced end to end.

3.4 Cross-app contract ownership

Before editing any shared contract, schema, DTO, enum, package format or cross-app helper:

- identify the owning domain/provider;
- trace all known producers and consumers;
- list the affected apps before editing;
- preserve backwards compatibility where live/migration paths depend on the old shape;
- prefer one canonical contract over app-local copies;
- do not change a shared contract merely to make one consumer convenient.

When a shared contract changes, validation must include the provider and every directly affected consumer. A green provider test alone is not sufficient.

3.5 Versioning and history

Historical business evidence must not be rewritten in place.

Where the domain already uses snapshots/revisions/publications/events:
- preserve immutable historical snapshots;
- create a new revision/version for changed commercial or safety evidence;
- preserve who/when/source metadata;
- make supersession or withdrawal explicit;
- keep current operational state separate from historical evidence.

Do not retroactively edit an old published menu, quote, allergen archive or equivalent evidence merely to make it match today's data.

3.6 Amendments and cancellations

After downstream handoff, a change is normally an amendment, not an invisible edit.

Amendments should be explicit, version-aware, idempotent where externally retried, and propagated to affected downstream systems.

Cancellations/withdrawals must have explicit semantics and must remove or update stale downstream operational work. Do not rely on disappearance from a source query as the cancellation mechanism.

3.7 Idempotency

Any command that can be retried across an app or network boundary must be designed for replay safety.

Use existing idempotency/version mechanisms where available. Do not create duplicate Production Orders, fulfilment requirements, publications, movements or documents because a user double-clicked or a request was retried.

3.8 Allergens and safety data

Allergen state is safety-critical operational data.

Preserve explicit states such as:
UNRECORDED
CLEAR
CONTAINS
MAY_CONTAIN

Never treat missing/unknown/unrecorded data as clear.

For signed allergen releases, CPU owns an immutable release bound to the frozen matrix hash. Any post-signing allergen change must revoke the current release, invalidate its signatures and packet/artifacts, withdraw downstream current pointers, and require a new review and dual signature. Delivered-In may consume only the current verified compressed CPU packet; historical revoked artifacts remain audit evidence but are never operationally current.

Do not infer vegetarian/vegan or allergen status from unrelated display labels unless the domain explicitly defines that mapping.

When current allergen truth and historical published evidence differ, preserve both: current operational truth can change, historical evidence remains immutable.

3.9 OPLOC and destinations

OPLOC is a governed operational-location identity.

Do not create fake permanent OPLOC records merely to represent a one-off delivery address.

A one-off destination should be represented as an explicit request/order-scoped destination identity/address snapshot, while governed sites continue to use canonical OPLOC IDs.

Do not join destinations by display name.

Historical OPLOC IDs must resolve through the existing redirect/alias authority before authorization or service-arrangement filtering. A historical and current ID for the same location must never surface as two operational sites.

3.10 Dates and timezone

Operational dates/times are UK business dates unless a domain explicitly states otherwise.

Be deliberate about Europe/London, BST/GMT transitions, date-only values and UTC timestamps.

Do not derive a UK operational date by blindly slicing an ISO UTC timestamp.

Audit date boundaries, midnight behaviour and DST whenever changing calendar, delivery, publication, booking or production logic.

==================================================
4. AUTHENTICATION, AUTHORISATION AND ACTORS
==================================================

Use the existing actor/session/authentication mechanism for the application being changed.

Do not hardcode real staff names or identities into production write paths.

Synthetic identities are acceptable only through an explicit local/dev/test mechanism and must not leak into production behaviour.

Server-side trust boundaries must remain server-side. Do not weaken existing Firestore/Admin SDK or API boundaries for convenience.

When auditing, distinguish authentication from authorisation: a logged-in user is not automatically entitled to every domain action or site.

AUTHMOD must remain fail-closed. Missing or invalid scope/redirect information must never silently broaden access.

==================================================
5. PERSISTENCE AND DATA SAFETY
==================================================

Before changing persistence, classify the data:

stable reference/seed data;
authoritative operational data;
immutable audit/history;
generated document/artifact metadata;
cache/projection;
local development/test fixture;
recovery/backup.

Do not commit mutable runtime data simply to make local behaviour convenient.

Do not blanket-commit local-data/.

Prefer deterministic seed/migration/recovery paths for reference data and test fixtures.

If SQLite or file-backed operational data is used, inspect concurrency, locking, backup/recovery and deployment persistence assumptions.

If Firestore is used, inspect query bounds, indexes, read/write amplification, emulator-vs-production differences and direct-client access rules.

5.1 Read-package / projection state taxonomy

For compiled snapshots, compressed packages, manifests and projections, distinguish these states explicitly:

1. HIT / CURRENT
   - integrity valid;
   - source/version current;
   - serve normally.

2. MISSING BUT REBUILDABLE
   - derived materialisation absent;
   - authoritative source is available and valid;
   - rebuild safely when the domain allows it;
   - coalesce concurrent rebuilds to avoid duplicate expensive work.

3. STALE
   - materialisation exists but no longer matches authoritative source/version;
   - do not pretend it is current;
   - refresh/rebuild/invalidate according to domain rules.

4. INTEGRITY FAILED / CORRUPT
   - checksum/hash/signature/contract validation failed;
   - fail closed;
   - never silently self-heal and serve data as if no integrity event occurred.

Do not collapse these states into a generic 503 when safe recovery is possible, and do not convert integrity failures into automatic recovery.

5.2 Historical package compatibility / migration

When introducing a new package, snapshot, manifest or cache format, design for pre-existing operational data.

A new write path that only creates packages for future mutations is incomplete if historical weeks/records remain valid operational inputs.

Provide one of:
- deterministic lazy materialisation from authoritative historical data;
- explicit migration/backfill tooling;
- a documented compatibility path;
- an intentionally unsupported boundary with a clear operational reason.

Add regression coverage for at least one historical/pre-migration record where the feature can encounter old data in normal UAT/live use.

5.3 No silent stale fallback

Do not silently serve stale cached/projection data as current merely to avoid an error.

Stale-but-known-good fallback is allowed only when the domain contract explicitly permits it and the UI/API clearly represents that freshness state.

For operational or safety-critical data, prefer `unavailable`, `pending refresh`, `withdrawn`, or equivalent explicit state over falsely current data.

5.4 GCS compressed-package invariant

Google Cloud Storage may transparently decompress objects stored with `Content-Encoding: gzip` when they are downloaded.

When a FIKA OS package hash, checksum, signature or integrity check is defined over the compressed bytes, the storage read must preserve those exact compressed bytes. With the Google Cloud Storage Node client this means using `download({ decompress: false })` (or the equivalent explicit raw-byte option) rather than relying on the default download behaviour.

Required package roundtrip:

serialize
→ gzip
→ hash/sign compressed bytes
→ upload with Content-Encoding: gzip
→ download with transparent decompression disabled
→ verify the same compressed-byte hash/signature
→ explicitly decompress
→ parse

Do not verify a compressed-byte hash after an implicitly decompressed download.

Any new or changed gzip-backed package store must include a regression test that roundtrips through the storage adapter and proves that the uploaded compressed bytes, downloaded compressed bytes and integrity hash are identical.

5.5 Logging, audit and operational evidence

`docs/ai/LOGGING-AUDIT-STRATEGY.md` is a standing platform requirement.

FIKA OS must be able to reconstruct important business mutations without turning routine telemetry into a high-volume Firestore workload.

Keep these concerns separate:
- business audit/domain events — durable append-only evidence of meaningful state changes;
- technical/application logs — structured diagnostics for failures, latency, retries and runtime behaviour;
- Google Drive archive — optional batched long-term exported copies, not the live audit database.

Prefer an existing durable domain/change event to also serve as audit evidence when it already contains the required actor/entity/version/source/lineage information. Do not automatically add a third duplicate audit write beside every state write and domain event.

Meaningful business mutations should leave durable evidence at the authoritative server/domain boundary. Important state changes must not depend on a best-effort client-side logging request after the real mutation succeeds.

Where practical, record authoritative state plus its audit/domain event atomically. Where stores/services differ, use an existing durable outbox/change-stack/retry-safe mechanism rather than silently accepting an audit gap.

Do not create Firestore audit documents for page views, renders, polling cycles, cache refreshes or successful reads that cause no business change.

Business audit/history queries must be bounded and paginated/cursor-based as volume grows. Do not subscribe every dashboard to a complete audit stream.

Technical logs should not default to one Firestore write per log line. Never log credentials, tokens, secrets or unnecessary sensitive payloads.

If Google Drive archival is introduced, export events/logs in deliberate batches at an agreed cadence. Do not update a Drive file once per individual event and do not make Drive the authority for current operational state.

Cross-app evidence should preserve stable IDs/correlation/causation references so a booking/request can be traced through Production, Fulfilment and Logistics without name matching.

==================================================
6. PERFORMANCE AND COST INVARIANTS
==================================================

`COST-EFFICIENCY.md` is a standing requirement.

In particular:
- query the smallest useful scope;
- cache stable reference data;
- do not add broad realtime listeners by default;
- do not solve perceived latency by globally changing polling to one second;
- refresh immediately after the user's own mutation where practical;
- use projections/change feeds/invalidation where the architecture already supports them;
- avoid unbounded collection reads in user-facing paths;
- write only on meaningful state changes;
- document recurring read/write behaviour for new periodic work.

When investigating slowness, measure stages rather than guessing:

T0 user action
T1 source API confirms
T2 durable event/store accepts
T3 projection/materialisation updates
T4 destination UI displays

Separate command latency from downstream visibility latency.

6.1 Firestore read-shape discipline

Treat Firestore reads as a bounded operational resource.

Before adding or changing a Firestore-backed read path, ask whether the request can be resolved by:
- deterministic document ID;
- tightly bounded indexed query;
- existing projection/read model;
- manifest/version check;
- immutable compiled snapshot;
- IndexedDB or other existing cache;
- targeted change feed/invalidation.

Do not scan a collection merely because it is convenient to filter in application code.

Known IDs should normally become direct document reads.

Mutation paths should read only the affected aggregate and the minimum related state required for correctness. Do not read unrelated weeks, publications, events, assignments or canonical entities inside a transaction.

Whole-collection reads are acceptable only for deliberate administrative, maintenance, migration or genuinely catalogue-wide workflows. They must not accidentally sit on ordinary interactive paths.

Design both cold-cache and warm-cache behaviour. A path that is cheap for one warm developer session but expensive when 40 users cold-start simultaneously is not considered efficient.

Prefer immutable compiled read models for published/final operational data when repeated consumers would otherwise reconstruct the same result from multiple collections.

Do not use higher polling frequency to compensate for stale projections. Prefer targeted invalidation, manifests, change feeds or post-mutation refresh.

Firestore remains server-side only unless the architecture explicitly approves a different trust boundary.

Do not trade away correctness guarantees such as optimistic concurrency, transaction boundaries, immutable history, outbox/idempotency or AUTHMOD enforcement merely to reduce reads.

For significant Firestore-backed features, report the expected read shape for the primary cold and warm paths. Where practical, add read-budget regression tests to prevent broad-read regressions.

==================================================
7. CHANGE DISCIPLINE AND PARALLEL WORK
==================================================

7.1 Parallel implementation policy

Parallelism is an optimisation, not a requirement.

Default behaviour:
- use one implementation thread for tightly coupled work;
- use parallel work only when scopes can be cleanly separated;
- default maximum: TWO concurrent write-capable implementation threads;
- if subagent/agent capacity or usage limits are constrained, run the same technical plan serially rather than changing the design.

For explicitly parallel waves:
- number each thread/task;
- give each thread exclusive app/file/package ownership;
- record the shared `origin/main` baseline SHA;
- start every temporary task branch from that same baseline;
- do not allow concurrent edits to the same files;
- do not deploy from task branches;
- integrate completed work sequentially back to `main`;
- run a final integration/regression pass after the wave converges.

Where one task depends on another:
- define the provider contract and ownership boundary;
- complete or stabilise that provider contract;
- start the dependent implementation afterwards;
- integrate only after both sides are ready.

Do not fan out work merely because subagents are available. The cost of duplicate monorepo context, repeated builds and merge conflicts must be justified by real independence.

7.2 Before editing

Inspect the relevant UI, API route, domain/service layer, persistence layer, shared contracts and tests.

Identify which domain owns the state.

Trace downstream and upstream callers before changing a shared type or contract.

Search for nested AGENTS.md, local README/docs and package scripts in the affected tree.

Prefer the smallest coherent change that preserves platform invariants.

7.3 While editing

Do not redesign accepted workflows without an explicit product requirement.

Do not perform broad aesthetic/system refactors during a correctness fix.

Do not replace a proven shared contract with a parallel structure.

Do not hide a domain problem with UI-only fallback data.

Do not silently swallow failures that can leave downstream state stale.

Do not use `window.alert` / `window.prompt` as a shortcut in polished operational workflows unless already explicitly accepted.

Preserve backwards compatibility when live or migration code still depends on an older contract.

Preserve unrelated local changes and classify dirty files before staging.

Do not deploy, migrate, mutate Firestore or change secrets unless the user explicitly requests it.

Use shared packages or app-local HTTP adapters instead of sibling-app production imports.

Keep normal Firestore reads bounded by stable IDs, date scopes or explicit limits.

Avoid GET endpoints with surprising write side effects.

Preserve AUTHMOD fail-closed semantics and configured friendly runtime URLs.

7.4 After editing

Run the narrowest relevant tests first.

Run typecheck/build for affected apps where scripts exist.

Run integration/E2E tests when crossing app boundaries.

Report commands actually run and their results.

Report anything not run and why.

Never claim a suite is green if it was not executed successfully.

Do not invent validation commands. Read the affected app's `package.json` and existing scripts.

==================================================
8. TESTING EXPECTATIONS
==================================================

Tests should cover business invariants, not just rendering.

For changed operational flows consider:
- happy path;
- invalid input;
- duplicate/retry/idempotency;
- amendment;
- cancellation/withdrawal;
- stale version/concurrency;
- cross-app materialisation;
- projection refresh/removal;
- empty/unknown data;
- Europe/London date boundary;
- allergen UNRECORDED vs CLEAR where relevant;
- governed OPLOC vs one-off destination where relevant;
- persistence/restart behaviour where relevant;
- durable audit/domain evidence for critical state changes where relevant.

Use isolated test databases/data stores. A green test that depends on state left by another test is not reliable.

The Golden Week UAT tooling is intended as an end-to-end contract for representative operational data. Preserve and extend it rather than creating unrelated whole-system fixtures when possible.

8.1 Minimum UAT regression set for Menu Planning → CPU → Delivered-In

Any change materially affecting this chain should, where applicable, verify at least:

1. normal populated published day/week;
2. intentionally blank published day;
3. whole-week/day withdrawal and downstream invalidation;
4. valid republish after withdrawal;
5. legacy governed OPLOC redirect resolving to the current canonical ID;
6. missing derived package with valid authoritative source;
7. integrity-corrupt package remains fail-closed;
8. stale client cache revalidates to current data.

Do not claim this chain is UAT-safe when only the happy populated-day path was tested.

==================================================
9. APP-SPECIFIC OPERATING RULES
==================================================

9.1 Integration Hub / AUTHMOD

- Hub/AUTHMOD is the authority for access scope and OPLOC redirect resolution.
- Historical OPLOC assignments must canonicalise before authorization/service filtering.
- Never grant broader access because redirect/scope data is missing.
- Avoid duplicating governed OPLOC identity lists in consumer apps where Hub authority can be used.

9.2 Menu Planning

- Menu Planning owns menu intent, portions, destinations and publication.
- Whole-week publication/withdrawal must preserve immutable history and optimistic/version protections.
- Intentionally blank service days are valid published states and must remain distinguishable from missing/unpublished days.
- Withdrawal must produce durable downstream cancellation/withdrawal semantics; downstream replay may be pending, but local withdrawal remains authoritative.

9.3 CPU Production

- CPU owns operational production state after accepted handoff.
- Derived CPU projection/package absence must be distinguished from integrity failure.
- Safe missing-package recovery may rebuild from authoritative canonical production data; integrity failure must remain fail-closed.
- Coalesce concurrent rebuilds for the same bounded aggregate/week.
- Do not invent production work for intentionally blank published days.

9.4 Delivered-In

- Delivered-In is a projection/consumer, never a second production/menu/logistics authority.
- Preserve week/day navigation and the distinction between populated, intentionally blank, missing, unavailable and withdrawn dates.
- IndexedDB/cache behaviour must validate version/hash/freshness and evict or invalidate withdrawn/stale current pointers.
- Do not hide valid published blank days because their entry list is empty.

9.5 Logistics

- Logistics owns movement/dispatch state, not upstream menu/production truth.
- Do not invent movements for blank/no-service production dates.
- Withdrawal/cancellation upstream must remove or supersede stale fulfilment/movement requirements according to existing contracts.

==================================================
10. STAGING PROVENANCE AND DEPLOYMENT
==================================================

10.1 Staging provenance before diagnosis

Before diagnosing a staging-only bug, prove which commit SHA the affected staging app is actually serving.

Do not assume staging equals current `main` merely because deployment was recently requested.

For each affected app, record:
- expected source SHA;
- verifiable deployed/staging SHA or rollout identifier where exposed;
- whether the observed staging behaviour is from the same commit being inspected.

If provenance cannot be verified, state that explicitly before attributing a bug to current source.

A source feature already present on `main` but absent on staging should trigger a provenance/deployment check before reimplementing that feature.

10.2 Exact-SHA deployment rule

Deploy only validated commits.

Do not deploy an ambiguous moving target such as “whatever is currently latest” when an exact validated SHA is available.

When deploying multiple FIKA OS apps, report the exact source SHA for each rollout and any deployment/build identifier returned by the platform.

Never imply that a submitted rollout is live unless live verification was actually performed.

Deployment handoff: once a deployment command has successfully submitted/queued a rollout and returned enough information to identify it, do not sit idle waiting for Firebase App Hosting to compile/propagate unless the user explicitly requests live verification. Report the submitted deployment, target app(s), exact SHA and rollout/build identifier, then stop.

==================================================
11. FORMAL AUDIT MODE
==================================================

When instructed to perform a codebase audit, read and obey both:

`docs/ai/CODEBASE-AUDIT-PROTOCOL.md`
`docs/ai/LOGGING-AUDIT-STRATEGY.md`

Audit mode is read-only by default.

Do not fix production code while conducting the baseline audit unless the user explicitly changes the mission.

A finding must be evidence-based and traceable to concrete code, configuration, tests or runtime behaviour. Do not pad an audit with generic best-practice commentary.

The audit must distinguish:
- confirmed defect;
- high-confidence risk;
- design debt;
- test/documentation gap;
- intentionally accepted behaviour;
- area inspected with no finding.

Every core-app audit must explicitly assess auditability/observability: whether important mutations can be reconstructed with stable actor, action, entity, version, source and cross-app lineage evidence, without excessive recurring read/write behaviour.

==================================================
12. DOCUMENTATION AUTHORITY
==================================================

Documentation can be stale. Code can also encode accidental behaviour.

When they disagree:
- identify the disagreement;
- inspect current domain tests and live call paths;
- consult project history/invariants;
- report the conflict rather than silently choosing whichever source is easier.

The root README.md may describe older repository structure and must not be treated as a complete current platform map without verification.

==================================================
13. AGENT COMPLETION STANDARD
==================================================

A coding task is not complete merely because the page renders or TypeScript compiles.

A strong completion report states:
- what changed;
- why that is the correct domain boundary;
- files/areas touched;
- migrations/data implications;
- downstream/upstream implications;
- tests/typecheck/build/E2E actually run;
- known limitations or intentionally deferred work;
- any new operational or cost behaviour;
- any new or changed audit/logging behaviour for meaningful mutations.

A formal audit completion report must instead follow the output requirements in `docs/ai/CODEBASE-AUDIT-PROTOCOL.md` and the auditability requirements in `docs/ai/LOGGING-AUDIT-STRATEGY.md`.
