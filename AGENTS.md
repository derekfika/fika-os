FIKA OS — Agent Operating Guide

This file is the repository-wide operating guide for AI coding and review agents working on FIKA OS.

It is intentionally a map and a set of invariants, not a complete description of every implementation detail. Inspect the current code before making claims or changes. More-specific AGENTS.md files lower in the tree are additive and take precedence for their directory scope.

Important: apps/delivered-in/AGENTS.md contains Next.js-generated agent guidance. Preserve it and obey it when working in that app.

1. What FIKA OS is

FIKA OS is one operational platform made up of several applications and entry routes.

The core principle is:

Different entry routes. One downstream operational truth.

Hospitality, Menu Planning, Grab & Go, Ad-Hoc Production and other workflows may begin differently, but once work reaches Production and Fulfilment it must use shared canonical contracts rather than inventing parallel operational domains.

The platform has evolved quickly. Do not assume an old README or legacy folder describes the current architecture. Inspect current code, current schemas and current runtime paths.

Useful repository context:

FIKA-OS-DEVELOPMENT-HISTORY.md — project evolution and architectural intent.

COST-EFFICIENCY.md — standing performance and metered-service guardrails.

LOCAL-WORKSPACE.md — local supervisor, ports and emulator workflow.

CHANGELOG.md — recent notable changes where maintained.

docs/ai/LOGGING-AUDIT-STRATEGY.md — mandatory platform rules for business audit evidence, technical diagnostics and archival.

docs/ai/CODEBASE-AUDIT-PROTOCOL.md — mandatory process for a formal whole-codebase audit.

2. Current platform areas

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

Legacy sites/ content and older scripts may remain for compatibility, migration or recovery. Do not remove or rewrite legacy paths merely because a newer app exists. Establish whether they are still operational first.

3. Architecture invariants

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

Each application should own the information it is responsible for and hand off explicitly at domain boundaries.

Examples:

Hospitality owns booking authoring/commercial workflow before CPU handoff.

Menu Planning owns menu intent, portions/destinations and publication before production materialisation.

Ad-Hoc Production owns request/quote/menu/allergen authoring before Send to CPU.

CPU owns operational production state after accepted handoff.

Logistics owns planning, assignment, movement and dispatch state.

Delivered-In is primarily a site-facing projection/consumer, not a second logistics or production authority.

Do not silently mutate another domain's authoritative record from a UI convenience path.

3.3 Stable identity

Stable IDs are identity.

Never use display text, customer name, dish title, address label or other human-readable text as record identity when a stable ID exists or can be created.

Avoid name-based joins between applications.

Preserve IDs across projections, amendments and handoffs so the same occurrence can be traced end to end.

3.4 Versioning and history

Historical business evidence must not be rewritten in place.

Where the domain already uses snapshots/revisions/publications/events:

preserve immutable historical snapshots;

create a new revision/version for changed commercial or safety evidence;

preserve who/when/source metadata;

make supersession or withdrawal explicit;

keep current operational state separate from historical evidence.

Do not retroactively edit an old published menu, quote, allergen archive or equivalent evidence merely to make it match today's data.

3.5 Amendments and cancellations

After downstream handoff, a change is normally an amendment, not an invisible edit.

Amendments should be explicit, version-aware, idempotent where externally retried, and propagated to affected downstream systems.

Cancellations/withdrawals must have explicit semantics and must remove or update stale downstream operational work. Do not rely on disappearance from a source query as the cancellation mechanism.

3.6 Idempotency

Any command that can be retried across an app or network boundary must be designed for replay safety.

Use existing idempotency/version mechanisms where available. Do not create duplicate Production Orders, fulfilment requirements, publications, movements or documents because a user double-clicked or a request was retried.

3.7 Allergens and safety data

Allergen state is safety-critical operational data.

Preserve explicit states such as:

UNRECORDED

CLEAR

CONTAINS

MAY_CONTAIN

Never treat missing/unknown/unrecorded data as clear.

Do not infer vegetarian/vegan or allergen status from unrelated display labels unless the domain explicitly defines that mapping.

When current allergen truth and historical published evidence differ, preserve both: current operational truth can change, historical evidence remains immutable.

3.8 OPLOC and destinations

OPLOC is a governed operational-location identity.

Do not create fake permanent OPLOC records merely to represent a one-off delivery address.

A one-off destination should be represented as an explicit request/order-scoped destination identity/address snapshot, while governed sites continue to use canonical OPLOC IDs.

Do not join destinations by display name.

3.9 Dates and timezone

Operational dates/times are UK business dates unless a domain explicitly states otherwise.

Be deliberate about Europe/London, BST/GMT transitions, date-only values and UTC timestamps.

Do not derive a UK operational date by blindly slicing an ISO UTC timestamp.

Audit date boundaries, midnight behaviour and DST whenever changing calendar, delivery, publication, booking or production logic.

4. Authentication, authorisation and actors

Use the existing actor/session/authentication mechanism for the application being changed.

Do not hardcode real staff names or identities into production write paths.

Synthetic identities are acceptable only through an explicit local/dev/test mechanism and must not leak into production behaviour.

Server-side trust boundaries must remain server-side. Do not weaken existing Firestore/Admin SDK or API boundaries for convenience.

When auditing, distinguish authentication from authorisation: a logged-in user is not automatically entitled to every domain action or site.

5. Persistence and data safety

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

Deployment handoff: When a deployment has been successfully submitted/queued and the deployment command has returned enough information to identify the rollout, do not sit idle waiting for Firebase App Hosting to finish compiling or propagating unless the user explicitly asks for live verification. Report the submitted deployment, target app(s), commit SHA and any rollout/build identifier, then stop. Derek can verify when staging becomes live.

5.1 GCS compressed-package invariant

Google Cloud Storage may transparently decompress objects stored with
Content-Encoding: gzip when they are downloaded.

When a FIKA OS package hash, checksum, signature or integrity check is defined
over the compressed bytes, the storage read must preserve those exact
compressed bytes. With the Google Cloud Storage Node client this means using
download({ decompress: false }) (or the equivalent explicit raw-byte option)
rather than relying on the default download behaviour.

The required package roundtrip is:

serialize
→ gzip
→ hash/sign compressed bytes
→ upload with Content-Encoding: gzip
→ download with transparent decompression disabled
→ verify the same compressed-byte hash/signature
→ explicitly decompress
→ parse

Do not verify a compressed-byte hash after an implicitly decompressed download.

Any new or changed gzip-backed package store must include a regression test that
roundtrips through the storage adapter and proves that the uploaded compressed
bytes, downloaded compressed bytes and integrity hash are identical.

5.2 Logging, audit and operational evidence

docs/ai/LOGGING-AUDIT-STRATEGY.md is a standing platform requirement.

FIKA OS must be able to reconstruct important business mutations without turning routine telemetry into a high-volume Firestore workload.

Keep these concerns separate:

business audit/domain events — durable append-only evidence of meaningful state changes;

technical/application logs — structured diagnostics for failures, latency, retries and runtime behaviour;

Google Drive archive — optional batched long-term exported copies, not the live audit database.

Prefer an existing durable domain/change event to also serve as audit evidence when it already contains the required actor/entity/version/source/lineage information. Do not automatically add a third duplicate audit write beside every state write and domain event.

Meaningful business mutations should leave durable evidence at the authoritative server/domain boundary. Important state changes must not depend on a best-effort client-side logging request after the real mutation succeeds.

Where practical, record authoritative state plus its audit/domain event atomically. Where stores/services differ, use an existing durable outbox/change-stack/retry-safe mechanism rather than silently accepting an audit gap.

Do not create Firestore audit documents for page views, renders, polling cycles, cache refreshes or successful reads that cause no business change.

Business audit/history queries must be bounded and paginated/cursor-based as volume grows. Do not subscribe every dashboard to a complete audit stream.

Technical logs should not default to one Firestore write per log line. Never log credentials, tokens, secrets or unnecessary sensitive payloads.

If Google Drive archival is introduced, export events/logs in deliberate batches at an agreed cadence. Do not update a Drive file once per individual event and do not make Drive the authority for current operational state.

Cross-app evidence should preserve stable IDs/correlation/causation references so a booking/request can be traced through Production, Fulfilment and Logistics without name matching.

6. Performance and cost invariants

COST-EFFICIENCY.md is a standing requirement.

In particular:

query the smallest useful scope;

cache stable reference data;

do not add broad realtime listeners by default;

do not solve perceived latency by globally changing polling to one second;

refresh immediately after the user's own mutation where practical;

use projections/change feeds/invalidation where the architecture already supports them;

avoid unbounded collection reads in user-facing paths;

write only on meaningful state changes;

document recurring read/write behaviour for new periodic work.

When investigating slowness, measure the stages rather than guessing:


T0 user action

T1 source API confirms

T2 durable event/store accepts

T3 projection/materialisation updates

T4 destination UI displays


Separate command latency from downstream visibility latency.

6.1 Firestore read-shape discipline

Treat Firestore reads as a bounded operational resource.

Before adding or changing a Firestore-backed read path, ask whether the request can be resolved by:

deterministic document ID;

tightly bounded indexed query;

existing projection/read model;

manifest/version check;

immutable compiled snapshot;

IndexedDB or other existing cache;

targeted change feed/invalidation.

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

7. Change discipline

7.1 Parallel implementation policy

For non-trivial work, subagents are write-capable by default, not audit-only.

Parallelise implementation whenever exclusive file, app or package ownership can
be cleanly separated. Investigation, implementation, testing and verification
should run concurrently where their scopes are independent.

Assign every write-capable subagent an explicit exclusive scope. Do not allow
multiple agents to edit the same files concurrently.

Prefer parallel write waves over serial coordinator implementation:

Wave 1: independent providers, apps or packages can be implemented in parallel.

Wave 2: dependent consumers start once the provider contract they depend on is
established.

Independent verification can run against completed scopes while other disjoint
implementation continues.

Where one task depends on another:

define the provider contract and ownership boundary;

complete or stabilise that provider contract;

start the dependent write agent;

integrate only after both sides are ready.

The coordinator owns:

task decomposition and ownership boundaries;

shared contract decisions;

integration of completed agent work;

conflict resolution;

final validation;

commit, push and deployment when authorised.

The coordinator should not reimplement work already assigned to a subagent
unless integration genuinely requires it. Do not use subagents only to produce
read-only reports and then serially repeat their implementation work in the
coordinator.

Do not create a persistent branch per agent merely to enable parallel work.
Use isolated agent workspaces/worktrees provided by the tooling where available,
and keep normal UAT fixes on the canonical UAT branch unless a genuinely risky
or unavoidable parallel experiment requires separate branch isolation.

Significant fixes require independent verification before final integration.
Simple, genuinely single-file or tightly coupled low-risk fixes may remain
coordinator-only when splitting them would add overhead without useful
parallelism.

Preserve unrelated worktree changes and classify dirty files before staging. Do not deploy, migrate, mutate Firestore or change secrets unless the user explicitly requests it. Use shared packages or app-local HTTP adapters instead of sibling-app production imports. Keep normal Firestore reads bounded by stable IDs, date scopes or explicit limits, and avoid GET endpoints with surprising write side effects. Preserve AUTHMOD fail-closed semantics and configured friendly runtime URLs. Validate changes with relevant tests, typecheck, production build and git diff --check.

Before editing:

Inspect the relevant UI, API route, domain/service layer, persistence layer, shared contracts and tests.

Identify which domain owns the state.

Trace downstream and upstream callers before changing a shared type or contract.

Search for nested AGENTS.md, local README/docs and package scripts in the affected tree.

Prefer the smallest coherent change that preserves platform invariants.

While editing:

do not redesign accepted workflows without an explicit product requirement;

do not perform broad aesthetic/system refactors during a correctness fix;

do not replace a proven shared contract with a parallel structure;

do not hide a domain problem with UI-only fallback data;

do not silently swallow failures that can leave downstream state stale;

do not use window.alert/window.prompt as a shortcut in polished operational workflows unless already explicitly accepted;

preserve backwards compatibility when live or migration code still depends on an older contract.

After editing:

run the narrowest relevant tests first;

run typecheck/build for affected apps where scripts exist;

run integration/E2E tests when crossing app boundaries;

report commands actually run and their results;

report anything not run and why;

never claim a suite is green if it was not executed successfully.

Do not invent validation commands. Read the affected app's package.json and existing scripts.

8. Testing expectations

Tests should cover business invariants, not just rendering.

For changed operational flows consider:

happy path;

invalid input;

duplicate/retry/idempotency;

amendment;

cancellation/withdrawal;

stale version/concurrency;

cross-app materialisation;

projection refresh/removal;

empty/unknown data;

Europe/London date boundary;

allergen UNRECORDED vs CLEAR where relevant;

governed OPLOC vs one-off destination where relevant;

persistence/restart behaviour where relevant;

durable audit/domain evidence for critical state changes where relevant.

Use isolated test databases/data stores. A green test that depends on state left by another test is not a reliable test.

The Golden Week UAT tooling is intended as an end-to-end contract for representative operational data. Preserve and extend it rather than creating unrelated whole-system fixtures when possible.

9. Formal audit mode

When instructed to perform a codebase audit, read and obey both:

docs/ai/CODEBASE-AUDIT-PROTOCOL.md

docs/ai/LOGGING-AUDIT-STRATEGY.md

Audit mode is read-only by default.

Do not fix production code while conducting the baseline audit unless the user explicitly changes the mission.

A finding must be evidence-based and traceable to concrete code, configuration, tests or runtime behaviour. Do not pad an audit with generic best-practice commentary.

The audit must distinguish:

confirmed defect;

high-confidence risk;

design debt;

test/documentation gap;

intentionally accepted behaviour;

area inspected with no finding.

Every core-app audit must explicitly assess auditability/observability: whether important mutations can be reconstructed with stable actor, action, entity, version, source and cross-app lineage evidence, without excessive recurring read/write behaviour.

10. Documentation authority

Documentation can be stale. Code can also encode accidental behaviour.

When they disagree:

identify the disagreement;

inspect current domain tests and live call paths;

consult project history/invariants;

report the conflict rather than silently choosing whichever source is easier.

The root README.md may describe older repository structure and must not be treated as a complete current platform map without verification.

11. Agent completion standard

A coding task is not complete merely because the page renders or TypeScript compiles.

A strong completion report states:

what changed;

why that is the correct domain boundary;

files/areas touched;

migrations/data implications;

downstream/upstream implications;

tests/typecheck/build/E2E actually run;

known limitations or intentionally deferred work;

any new operational or cost behaviour;

any new or changed audit/logging behaviour for meaningful mutations.

A formal audit completion report must instead follow the output requirements in docs/ai/CODEBASE-AUDIT-PROTOCOL.md and the auditability requirements in docs/ai/LOGGING-AUDIT-STRATEGY.md.