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

- `FIKA-OS-DEVELOPMENT-HISTORY.md` — project evolution and architectural intent.
- `COST-EFFICIENCY.md` — standing performance and metered-service guardrails.
- `LOCAL-WORKSPACE.md` — local supervisor, ports and emulator workflow.
- `CHANGELOG.md` — recent notable changes and UAT handoff.
- `docs/ai/LOGGING-AUDIT-STRATEGY.md` — business audit evidence, diagnostics and archival.
- `docs/ai/CODEBASE-AUDIT-PROTOCOL.md` — formal whole-codebase audit process.

Platform areas include:

- Integration Hub / AUTHMOD
- Hospitality Booking / Hospitality Manager
- CPU Production
- Menu Planning
- Delivered-In
- Grab & Go
- Logistics
- Events Dashboard
- Beverage Innovation
- Ad-Hoc Production
- FIKA OS launcher / supervisor tooling
- shared domain and fulfilment contracts

Legacy code may remain for compatibility, migration or recovery. Establish whether it is still operational before removing it.

==================================================
2. ARCHITECTURE INVARIANTS
==================================================

2.1 Canonical downstream flow

Prefer this model unless current code proves a deliberate exception:

entry workflow
→ owned domain object/request
→ explicit handoff
→ canonical Production Order
→ Fulfilment Requirement
→ Logistics/downstream operational projections

Do not create a second Production, Fulfilment or Logistics truth for a new upstream workflow.

2.2 Domain ownership

- Hospitality owns booking/commercial workflow before CPU handoff.
- Menu Planning owns menu intent, portions/destinations and publication before production materialisation.
- Ad-Hoc Production owns request/quote/menu/allergen authoring before Send to CPU.
- CPU owns operational production state after accepted handoff.
- Logistics owns planning, assignment, movement and dispatch state.
- Delivered-In is primarily a site-facing projection/consumer, not a second production or logistics authority.

Do not silently mutate another domain's authoritative record from a UI convenience path.

2.3 Stable identity

Stable IDs are identity.

Never use display text, customer name, dish title, address label or other human-readable text as record identity when a stable ID exists or can be created.

Avoid name-based joins between applications. Preserve IDs across projections, amendments and handoffs so the same occurrence can be traced end to end.

2.4 Versioning/history

Historical business evidence must not be rewritten in place.

Where the domain uses snapshots/revisions/publications/events:

- preserve immutable historical snapshots;
- create a new revision/version for changed commercial or safety evidence;
- preserve who/when/source metadata;
- make supersession or withdrawal explicit;
- keep current operational state separate from historical evidence.

Do not retroactively edit old published menus, quotes, allergen archives or equivalent evidence merely to match current data.

2.5 Amendments/cancellations/withdrawals

After downstream handoff, a change is normally an amendment, not an invisible edit.

Amendments must be explicit, version-aware and replay-safe where externally retried.

Cancellations and withdrawals must propagate explicit downstream invalidation/removal. Do not rely on disappearance from a source query as the cancellation mechanism.

2.6 Idempotency

Any command that can be retried across an app/network boundary must be replay-safe. Use existing idempotency/version mechanisms. Never create duplicate Production Orders, fulfilment requirements, publications, movements or documents because of retries or double-clicks.

2.7 Allergens/safety

Allergen state is safety-critical operational data.

Preserve explicit states such as:

- UNRECORDED
- CLEAR
- CONTAINS
- MAY_CONTAIN

Never treat missing/unknown/unrecorded data as clear.

For signed allergen releases, CPU owns an immutable release bound to the frozen matrix hash. Any post-signing allergen change must revoke the current release, invalidate signatures and packet/artifacts, withdraw downstream current pointers, and require a new review and dual signature.

Delivered-In may consume only the current verified CPU package. Historical revoked artifacts remain audit evidence but are never operationally current.

2.8 OPLOC/destinations

OPLOC is a governed operational-location identity.

- The Integration Hub canonical OPLOC model and redirect data are authority for operational identity.
- Historical OPLOC IDs may exist only as explicit compatibility aliases/redirects.
- Do not expose historical and current IDs as two separate operational sites.
- Resolve legacy IDs to current IDs before site-scoped authorization or consumer joins where the contract requires it.
- Do not create fake permanent OPLOCs for one-off addresses.
- Do not join destinations by display name.

2.9 Dates/timezone

Operational dates/times are UK business dates unless a domain explicitly says otherwise.

Be deliberate about `Europe/London`, BST/GMT transitions, date-only values and UTC timestamps.

Do not derive a UK operational date by blindly using `new Date().toISOString().slice(0, 10)`.

UTC arithmetic on an already-explicit ISO service date is fine; determining business “today” from UTC is not.

==================================================
3. AUTHENTICATION / AUTHORIZATION
==================================================

Use the existing actor/session/AUTHMOD mechanism for the application being changed.

- Do not hardcode real staff identities into production write paths.
- Synthetic identities are acceptable only through explicit dev/test mechanisms.
- Keep server-side trust boundaries server-side.
- Authentication is not authorization.
- Preserve AUTHMOD fail-closed behaviour when authorization authority is unavailable.
- OPLOC access decisions must respect canonical redirects rather than bypassing them with display-name matching.

==================================================
4. PERSISTENCE / DATA SAFETY
==================================================

Classify data before changing persistence:

- stable reference/seed data;
- authoritative operational data;
- immutable audit/history;
- generated document/artifact metadata;
- cache/projection/read package;
- local development/test fixture;
- recovery/backup.

Do not blanket-commit `local-data/` or mutable runtime state.

For Firestore, inspect query bounds, indexes, read/write amplification, emulator-vs-production differences and direct-client trust boundaries.

For SQLite/file-backed data, inspect concurrency, locking, backup/recovery and deployment persistence assumptions.

Deployment handoff: once a deployment command has successfully submitted/queued a rollout and returned enough information to identify it, do not sit idle waiting for App Hosting propagation unless the user explicitly asks for live verification. Report target app(s), SHA and rollout/build identifier, then stop.

==================================================
5. COMPRESSED READ-PACKAGE INVARIANT
==================================================

Google Cloud Storage may transparently decompress `Content-Encoding: gzip` objects on download.

When FIKA OS hashes/signs compressed bytes, preserve those exact compressed bytes on read. With the GCS Node client use `download({ decompress: false })` or equivalent.

Required roundtrip:

serialize
→ gzip
→ hash/sign compressed bytes
→ upload with Content-Encoding:gzip
→ download raw compressed bytes
→ verify hash/signature
→ explicitly decompress
→ parse

Any changed gzip-backed package store must include a regression test proving uploaded bytes, downloaded bytes and integrity hash are identical.

Package failure semantics:

1. integrity/hash/signature failure → fail closed;
2. missing derived package + authoritative source available → rebuild/self-heal where the domain can prove correctness;
3. authoritative source unavailable → fail closed;
4. stale client cache → revalidate/refetch/invalidate; never silently treat stale as current.

Do not convert corruption into automatic reconstruction merely to avoid a 503.

==================================================
6. LOGGING / AUDIT / OBSERVABILITY
==================================================

`docs/ai/LOGGING-AUDIT-STRATEGY.md` is mandatory.

Separate:

- durable business audit/domain events;
- structured technical diagnostics;
- optional batched Drive archival.

Prefer existing durable domain/change events as audit evidence when they already contain actor/entity/version/source/lineage. Do not add duplicate audit writes without a reason.

Important state changes must leave evidence at the authoritative server/domain boundary. Use transactions or durable outbox/change-stack mechanisms where practical.

Do not create Firestore audit documents for routine page views, renders, polling cycles or cache refreshes.

Never log credentials/tokens/secrets or unnecessary sensitive payloads.

Cross-app evidence should preserve stable IDs, correlation and causation references.

==================================================
7. PERFORMANCE / FIRESTORE DISCIPLINE
==================================================

`COST-EFFICIENCY.md` is mandatory.

Prefer:

- deterministic document IDs;
- tightly bounded indexed queries;
- existing projections/read models;
- manifest/version checks;
- immutable compiled snapshots;
- IndexedDB/existing caches;
- targeted invalidation/change feeds.

Do not scan collections merely because filtering in application code is convenient.

Known IDs should normally become direct document reads.

Mutation paths should read only the affected aggregate and minimum related state required for correctness.

Design both cold-cache and warm-cache behaviour. A path cheap for one warm developer session but expensive across many simultaneous cold starts is not efficient.

Do not increase polling frequency to compensate for stale projections.

Do not trade correctness guarantees — optimistic concurrency, transactions, immutable history, outbox/idempotency, AUTHMOD — merely to reduce reads.

For significant Firestore-backed features, report expected cold/warm read shape and add read-budget regression coverage where practical.

==================================================
8. CHANGE DISCIPLINE
==================================================

8.1 Usage-aware parallel implementation policy

Parallel implementation is an optimization, not a requirement.

Do NOT spawn subagents simply because a task is non-trivial. Agent/subagent capacity can be exhausted independently of other visible usage windows, so FIKA OS work must be designed to degrade cleanly to serial execution.

Default behaviour:

- one coordinator / one implementation thread;
- parallel analysis or verification is fine when useful;
- keep implementation serial when scopes overlap, shared contracts are unstable, or parallelism would consume disproportionate agent capacity.

When parallel implementation has a clear benefit:

- maximum default concurrency: TWO implementation threads;
- use explicit numbered threads (`THREAD 1`, `THREAD 2`, etc.);
- each thread gets exclusive file/app/package ownership;
- each thread starts from the same recorded `origin/main` baseline;
- do not allow concurrent edits to the same file or shared contract;
- do not let one task branch become another task's dependency branch;
- integrate completed work sequentially through `main`;
- perform a final integration/regression pass after all wave changes are on `main`.

Prefer two-thread waves over broad fan-out:

Wave 1: up to two independent high-priority fixes.
Wave 2: next independent pair after Wave 1 completes/integrates.
Final: one integration/regression thread.

Subagents vs separate Codex threads:

- use subagents only when the coordinator can maintain clear ownership and the work genuinely benefits from shared context;
- prefer separate numbered Codex threads for independently reviewable fixes when branch/SHA provenance matters;
- if subagent allowance/capacity is constrained, run the exact same plan sequentially rather than redesigning the technical approach;
- never reduce testing or correctness to save agent usage.

Parallel analysis does not authorize parallel writes to the same canonical checkout. If isolated task branches/workspaces are not explicitly being used, implement sequentially on `main`.

The coordinator owns:

- decomposition and thread numbering;
- ownership boundaries;
- shared contract decisions;
- review/integration order;
- conflict resolution;
- final validation;
- final push/deployment when authorized.

Significant fixes require independent verification before final integration. A genuinely small/tightly coupled fix should remain single-threaded when splitting it adds overhead without useful parallelism.

8.2 Before editing

- inspect relevant UI, API route, domain/service layer, persistence, shared contracts and tests;
- identify domain ownership;
- trace upstream/downstream callers before changing shared types/contracts;
- search for nested `AGENTS.md`, local README/docs and package scripts;
- prefer the smallest coherent change preserving platform invariants.

8.3 While editing

- do not redesign accepted workflows without a product requirement;
- do not perform broad aesthetic/system refactors during a correctness fix;
- do not replace a proven shared contract with a parallel structure;
- do not hide domain problems with UI-only fallback data;
- do not silently swallow failures that can leave downstream state stale;
- preserve backwards compatibility where live/migration code still requires an older contract;
- do not deploy, migrate, mutate production Firestore or change secrets unless explicitly requested.

8.4 After editing

- run narrow relevant tests first;
- run affected typecheck/build scripts where they exist;
- run integration/E2E tests for cross-app boundaries;
- run `git diff --check`;
- report commands actually run and their results;
- report anything not run and why;
- never claim a suite is green if it was not executed successfully;
- do not invent validation commands: read package scripts first.

==================================================
9. APP-SPECIFIC OPERATING RULES
==================================================

These rules live here deliberately rather than creating many nested `AGENTS.md` files. Add a nested file only when an app has durable local constraints that would otherwise make the root guide noisy or unsafe.

9.1 Integration Hub / AUTHMOD

- Hub canonical records and explicit redirects own governed OPLOC identity.
- AUTHMOD remains authority for app/site access.
- Resolve historical OPLOC redirects before scoped permission decisions where required.
- OPLOC/read-package data may aid presentation and canonicalization but must not become a second authorization source.
- Package integrity failures fail closed.

9.2 Menu Planning

- Menu Planning owns planning intent and publication, not CPU operational state.
- A published week may intentionally contain blank service days; blank is distinct from missing/unpublished.
- Week withdrawal is explicit, reasoned, auditable and must produce downstream invalidation events.
- Historical publications/snapshots remain immutable.
- Re-publication after withdrawal creates a clean new current version/publication state; never reactivate stale packets.
- Preserve bounded catalogue/snapshot reads and optimistic version protections.

9.3 CPU Production

- CPU owns canonical operational production state and signed allergen releases.
- Missing derived projection/read packages may self-heal from authoritative canonical production state when correctness is provable.
- Corrupt/invalid packages never self-heal silently; they fail closed.
- Historical weeks must remain readable through deterministic package rebuild/migration-safe paths where authoritative data exists.
- Coalesce simultaneous rebuilds for the same package/scope.
- Never invent production work for an intentionally blank published Menu Planning day.

9.4 Delivered-In

- Delivered-In is a consumer/projection, not authority for publication, production or allergens.
- Preserve the generated `apps/delivered-in/AGENTS.md` Next.js guidance.
- Week and day navigation must distinguish populated, intentionally blank, missing/unavailable and withdrawn service dates.
- Do not filter a valid published day merely because it has zero menu entries.
- IndexedDB/cache state must be invalidated on withdrawal/supersession/version change.
- Only current verified CPU-owned packet data may be treated as operational allergen truth.

9.5 Logistics

- Logistics consumes fulfilment requirements and owns movement/dispatch planning.
- Upstream withdrawal/cancellation must invalidate stale movement requirements rather than relying on missing source reads.
- Preserve stable occurrence IDs and cross-app lineage.

==================================================
10. TESTING EXPECTATIONS
==================================================

Tests should cover business invariants, not only rendering.

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
- intentionally blank published service day;
- Europe/London date boundary;
- allergen UNRECORDED vs CLEAR;
- governed current OPLOC vs historical alias;
- persistence/restart behaviour;
- durable audit/domain evidence.

Use isolated test data. A green test that depends on state left by another test is unreliable.

The Golden Week UAT tooling is an end-to-end contract for representative operational data. Preserve and extend it rather than creating unrelated whole-system fixtures when possible.

==================================================
11. FORMAL AUDIT MODE
==================================================

When instructed to perform a codebase audit, read and obey:

- `docs/ai/CODEBASE-AUDIT-PROTOCOL.md`
- `docs/ai/LOGGING-AUDIT-STRATEGY.md`

Audit mode is read-only by default unless the user explicitly changes the mission.

Findings must be evidence-based and distinguish:

- confirmed defect;
- high-confidence risk;
- design debt;
- test/documentation gap;
- intentionally accepted behaviour;
- area inspected with no finding.

Every core-app audit must assess auditability/observability without introducing excessive recurring reads/writes.

==================================================
12. DOCUMENTATION AUTHORITY
==================================================

Documentation can be stale. Code can also encode accidental behaviour.

When they disagree:

- identify the disagreement;
- inspect current tests and live call paths;
- consult project history/invariants;
- report the conflict rather than silently choosing the easier source.

The root README is not automatically a complete current platform map.

==================================================
13. COMPLETION STANDARD
==================================================

A coding task is not complete merely because the page renders or TypeScript compiles.

A strong completion report states:

- what changed;
- why the domain boundary is correct;
- files/areas touched;
- migrations/data implications;
- upstream/downstream implications;
- tests/typecheck/build/E2E actually run;
- known limitations/deferred work;
- new operational/cost behaviour;
- changed audit/logging behaviour;
- branch, starting SHA and final SHA;
- deployment status.

A formal audit completion report follows `docs/ai/CODEBASE-AUDIT-PROTOCOL.md` instead.