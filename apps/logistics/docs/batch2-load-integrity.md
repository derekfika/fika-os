# Batch 2 — Logistics load integrity

Date: 2026-10-02. Scope: A2 withdrawal/amendment reconciliation, A6 canonical load ownership/concurrency, B4 collection assignment parity. Deployment: none.

Logistics owns jobs, assignments, loads and planning. Fulfilment remains the upstream timing/source authority; its contract and AUTHMOD are unchanged. Direct consumers changed are the Logistics projection, desktop planner and mobile execution client.

## Canonical rules

- A creation identity binds service date, canonical origin/destination, delivery run, stable vehicle, arrival/end and collection-required semantics. Rescheduling preserves this ID. Occupied historical creation IDs receive a deterministic generation suffix rather than being overwritten.
- Reuse requires matching operational ownership and schedule. Adding a job cannot transfer a load to another run. Collection ownership and schedule are independent; projection merge keys retain these distinctions.
- `requestedWindow` is upstream truth. `scheduledTime`/`scheduledEnd` are Logistics planning truth. Arrival must be within the inclusive source window, or at/after an earliest-only source time. Service duration may extend beyond the source window. No source timing constraint adds no arrival restriction. Operator assignment/rescheduling never overwrites the source window.
- Withdrawal removes the affected assignment and retains the withdrawn job. The last departing member cancels its load; other members survive. Historical job/load audit evidence remains. Legacy native requirement references are reconciled by known stop IDs, retaining unrelated work and cleaning empty linked stops.
- Compatible source amendments update lineage without changing the operator schedule or load version. Incompatible origin, destination, service date or arrival constraints return work to planning. Readiness changes affect status, never job existence. Unchanged/older source replay does not churn versions or events.
- A deterministic assignment ID plus the transactionally read job document serializes competing assignments. Existing operator-observed load changes require canonical expected load versions; removals/moves also protect the job version. Stale commands return 409; missing required tokens return 422. Internal source reconciliation uses current transactional source truth.
- Native requirement, grouped requirement and projected job assignment use the same canonical helper. Legacy native assigned work must first return to planning before canonical reassignment; duplicate ownership fails closed. Collection rescheduling preserves delivery ownership/time and checks collection ownership separately.
- Queue, inspector and timeline send canonical version maps. Mobile execution sends the same load authority. Explicit queue Details/Set time buttons open on a single click; card drag interaction remains intact.
- Existing change publication/projection rebuilding continues. This batch does not resolve B1 event/outbox atomicity or the broader A3 execution contract.

## Read shape and deployment prerequisites

Cold and warm mutation paths use direct known job/run/load documents, indexed job/load membership queries, and date-scoped load/run queries. Native ownership checks read stops by each run in that date; grouped assignment caches date loads/native references within its transaction. Reconciliation reads the bounded date state once and follows known IDs. No whole Logistics collection scans or new periodic work were added. Stable IDs remain authority; no label joins were introduced.

No index definition was added in Batch 2. The undeployed Batch 1 Hub AuthorityGrant resource/status index remains a prerequisite, together with explicit per-vehicle person driver Contribute grants/app assignment and separate vehicle View/maintenance permissions. No grants were seeded. Legacy label-only runs and persisted conflicting vehicle/load owners require governed review/repair; they fail closed.

Before deploying clients requiring canonical concurrency metadata, reconcile/rebuild the operational date projections to include job/load version maps. Historical assignment documents remain readable and are normalized when explicitly mutated; no migration/backfill was executed. Existing native plans remain compatible until explicit return to planning. Deploy only reviewed exact SHAs and the necessary provider/consumer changes together.

## Validation

- `npm run test:load-integrity --prefix apps/logistics`: 72 passed (48 targeted load/reconciliation/API invariants plus 24 existing load/materialisation/projection/client regressions).
- `npm run test:authority --prefix apps/logistics`: 52 authority tests.
- `npm run test:access-regression --prefix apps/logistics`: 81 access regressions.
- `npm run typecheck --prefix apps/logistics` and nonincremental `node node_modules/typescript/bin/tsc --noEmit --incremental false` from the app.
- `npm run build --prefix apps/logistics`: production webpack build and standalone asset preparation.
- Playwright projects `batch2-load-integrity-chromium`, `batch1-authority-chromium`, `mounted-timeline-chromium`: 6 canonical-state parity scenarios, 6 authority scenarios and 41 mounted timeline scenarios. API writes use isolated in-memory route fixtures.
- Standard `npm run test` and `npm run test:integration` each attempted once: ENVIRONMENT-LIMITED before execution by `uv_os_get_passwd ENOMEM`. The focused transactional fixture is not emulator-backed integration proof.
- Scoped `git diff --check` and byte hashes for the intentionally dirty MNK menu data and root CHANGELOG.

No deployment, index deployment, grant changes, migrations or staging/production data actions. Root CHANGELOG intentionally remains byte-for-byte unchanged under the explicit Batch 2 preservation instruction; this document records the task entry instead. Style Guide compliance: PASS; existing components/tokens and distinct delivery/collection presentation retained.

## 2026-10-02 — Batch 2 Sol review correction (R1/R2)

Starting canonical main: `07261f2014edaae4520dd91cb9846959217a019a`. Prior review SHA: `9f296f6f69a1fef864ee761647b488cf73382097`. Domain: Logistics only. Deployment: none.

The shared transactional membership validator now checks compatible existing jobs, exactly one global assignment per job, and any active-load pointer. Same-load legacy/deterministic duplicates and cross-load ownership ambiguity return 409 without automatic repair. Loaded/execution, dispatch, rescheduling, removal, reuse and prior-load moves use this boundary. Internal withdrawal reconciliation groups removed documents by load, cancels only when no members remain, and increments each affected load once.

`reschedule-delivery-loads` accepts 1–50 unique canonical IDs and their expected versions. Both single and bulk commands share one implementation. Within one authorized transaction it reads every load, validates current owners and membership, requires the same projection grouping semantics, validates the proposed owner, resolves one common collision-adjusted schedule excluding constituent loads, validates every resulting source constraint, then writes all members. Immutable IDs and independent collection/delivery ownership remain intact. Any failure commits no member. Established per-load events and one projection rebuild follow the transaction; B1 remains out of scope.

The desktop submits one bulk placement intent for a projected card. Optimistic coordination, same-stop coalescing, authority retirement, passive refresh, geometry and execution model remain unchanged.

Validation commands are the same as above: load-integrity 93 passed (21 correction cases plus the previous 72); authority 52 passed; access 81 passed; typecheck and nonincremental tsc passed. Standard and API integration each attempted once and ENVIRONMENT-LIMITED by `uv_os_get_passwd ENOMEM` before execution; isolated transaction tests do not establish emulator integration. Production build and Chromium verification cover the corrected sources. Chromium includes 7 Batch 2 scenarios (one explicit merged-card single-request test), 6 Batch 1 authority scenarios and 41 mounted timeline scenarios. Scoped diff checks and original user-file byte hashes are verified before commit.

Files: `app/api/logistics/route.ts`, `app/page.tsx`, `lib/delivery-loads.ts`, `lib/load-assignment.ts`, `lib/logistics-materialisation.ts`, `lib/resource-authority.ts`, `lib/scheduling.ts`, `tests/load-integrity.test.cjs`, `tests/e2e/load-integrity.spec.ts`, and this task entry. No new indexes or deployment prerequisites beyond those already recorded. MNK/root CHANGELOG edits remain unchanged and uncommitted. Style Guide compliance: PASS; no presentation changes.
