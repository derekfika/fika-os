# Batch 3 — Authoritative driver execution and run lifecycle

2026-10-05 — Logistics A3/A9. Branch: `review/logistics-a3-a9-driver-execution`. Starting canonical main: `819e302202e3da101585e6a8bf61f6edafb7faf7`. Deployment: none.

## Authority and compatibility

LogisticsJob is the per-fulfilment-subload execution authority. Its optional, backwards-compatible `deliveryStatus` means `pending`, `loaded` or `delivered`; a missing historical field is pending. `collectionStatus` remains independently `awaiting` or `collected`. Neither state implies the other. Source reconciliation preserves delivery execution and timestamps. Source delivery constraints remain separate from operator scheduling.

DeliveryLoad retains immutable identity, ownership and timing. `deliveryExecution` and `collectionExecution` store independent arrivals, issues and whole-completion undo snapshots. Load loaded/delivered aggregates are derived from active member job states. Assignment additions, moves, removals and withdrawal recompute these aggregates. Cancelled history is retained. Normal projected fulfilment creates no native DeliveryStop records; synthetic stops remain read models.

The canonical provider and affected consumers are all Logistics: API/domain mutation, projection compiler, desktop planner and mobile workflow. Fulfilment/AUTHMOD contracts and stores are unchanged. Native stops remain authoritative for Movement Requests and existing native/legacy plans.

## Projected commands

All constituent IDs are bounded (1–50 unique IDs), resolved from canonical records, and compared with the full current date-scoped grouping. Current load versions, affected job versions, run version, compatible source truth, unique assignments and every current owner are checked server-side. Individual subload actions change only that job and its load aggregate; whole-stop actions commit all constituents atomically. A changed grouping or stale constituent cannot partially commit.

Loading is delivery-only and occurs in planned/ready runs. Stop execution requires its owning dispatched run, with explicit undo support for dispatched/completed runs. Completion requires loading for delivery, and arrival unless `confirmDirect` is supplied. Arrival is lane-specific; repeated arrival is rejected. A whole completion snapshot retains exact prior progress and observed post-completion job versions. Undo refuses intervening job changes and restores only its own lane, preserving previously completed individual jobs and the other lane. Native snapshots use explicit arrays so Firestore omission of undefined values cannot retain stale completion flags.

One reported issue has a stable identity across constituent loads. Copies survive later card splitting. Resolution changes only that issue, requires versions and access for every active copy, and re-evaluates affected run finalisation. Unrelated issues remain open. Responses include canonical load/job versions and the current run; mobile uses these and refreshes through the existing feed.

Legacy `mark-delivery-load-loaded` uses the same job execution helper. Unversioned `set-job-collection` is rejected in favour of governed collection execution. The secondary load-dispatch command cannot bypass run dispatch; run dispatch transitions all applicable delivery loads in the same transaction. Desktop whole-stop loading sends one execution intent rather than sequential load calls.

## Run lifecycle

One resolver reads native stops, active date-scoped delivery/collection loads and known member jobs. The first canonical assignment promotes a fresh draft run to planned transactionally; subsequent assignments/replays do not churn its run version. No synthetic native stop IDs are persisted. Ready and Dispatch use the same current source, timing, issue, ownership and governed-driver checks. Dispatch additionally requires every owned delivery subload/native delivery to be loaded. Planned-to-dispatched remains supported only through this complete predicate; ready-to-dispatched receives identical checks. Collection-only and projected-only work count as real work.

Finalisation considers only the legs a run owns. A collection owned by another run does not delay the delivery run. Open issues keep the run dispatched and block return. With no outstanding work/issues, return-required runs become return-pending; other runs complete. Resolving the final issue triggers this same predicate. Confirm Return and Complete Run check all native/projected work, issues and required return state transactionally. Native completion, issue resolution, undo and source-run finalisation after native postponement use this helper. Undo clears premature return/completion and reopens execution without changing unrelated projected progress.

Projected collection postponement is explicitly rejected by the server and its mobile control is absent with explanatory copy. Safe restoration remains coupled to A10. Existing native postponement remains available; general cross-date publication is unchanged.

## Read shape and audit

Cold and warm commands use known run/load/job documents, filtered load/job membership queries, one date-scoped load grouping query, and a bounded source-day request. Loading and arrival avoid reconstructing unrelated run job state. Commands that affect completion/issues resolve the owned run work to finalise correctly. Shared issue resolution follows only active copies of that issue within the same date, protecting every copy's version/owner. Lifecycle uses a run-filtered native stop query, date-filtered load query, and direct known member jobs. No whole Logistics collection scan, new periodic work or higher polling rate was added.

Canonical state and existing append-only audit arrays change in the transaction. Existing domain change events publish afterward and the current-day projection rebuilds once per execution intent. B1 post-commit event/outbox atomicity remains a known non-goal. No parallel audit or execution datastore was added. Timeline geometry, optimistic coordination and 15-minute passive desktop refresh are unchanged.

## Validation

- `npm run test:driver-execution --prefix apps/logistics`: 78 passed — 55 execution/lifecycle cases, 20 existing mobile regressions and 3 existing projection adapter regressions.
- `npm run test:load-integrity --prefix apps/logistics`: 93 passed — includes materialisation/projection/client regressions. Requests now explicitly carry the new execution authority; independent collection dispatch assertions reflect the approved state model.
- `npm run test:authority --prefix apps/logistics`: 52 passed. Seeded authority fixtures now contain current source identity and valid loaded delivery state; mixed-run completion verifies both domains.
- `npm run test:access-regression --prefix apps/logistics`: 81 passed.
- Chromium projects `batch3-driver-execution-chromium`, `batch2-load-integrity-chromium`, `batch1-authority-chromium`, `mounted-timeline-chromium`: 56 passed (2 + 7 + 6 + 41).
- Mounted mobile proves fresh projected assignment with no native stops, independent multi-job loading/delivery/collection, arrival, issue report/resolve, CPU return and completed run. A second journey proves merged constituent authority and exact whole-stop undo. All API writes are intercepted into isolated in-memory route fixtures.
- Typecheck, nonincremental TypeScript, production webpack build/standalone asset preparation and scoped diff check passed.
- Standard and API integration each attempted once: ENVIRONMENT-LIMITED before execution by `uv_os_get_passwd ENOMEM`. Focused transactions/browser fixtures are not emulator-backed integration proof.

## Deployment handoff

No new index definition. Cumulative prerequisites remain the undeployed Batch 1 Hub AuthorityGrant index, explicit person driver Contribute/app assignment and separate vehicle View/maintenance authority, and governed review of label-only or inconsistent legacy owners. Batch 2 canonical version metadata must be present in operational projections.

Deploy API, projection and clients together at a reviewed exact SHA, and publish/rebuild operational projection versions through the existing governed maintenance/invalidation process. Historical jobs missing delivery state fail closed as pending; aggregate loaded/collection flags never fabricate per-job delivery progress. Already-dispatched legacy projected work without canonical delivery state needs governed review before cutover. No inferred execution migration/backfill or operational data repair was performed. Legacy native execution remains available.

Root CHANGELOG and MNK menu edits remain byte-for-byte unchanged and uncommitted under the explicit task instruction; this document records the task entry. No deployment, index/grant/migration actions or staging/production data mutations. Style Guide compliance: PASS; existing components/tokens and mobile structure retained.

## Changed files (relative to `apps/logistics/`)

- UI/API: `app/api/logistics/route.ts`, `app/mobile/MobileWorkflow.tsx`, `app/page.tsx`.
- Domain/read models: `lib/delivery-loads.ts`, `lib/load-assignment.ts`, `lib/logistics-materialisation.ts`, `lib/logistics-projection.ts`, `lib/projection-dashboard-adapter.ts`, `lib/projected-execution.ts`, `lib/run-execution.ts`, `lib/types.ts`.
- Validation configuration: `package.json`, `playwright.config.ts`.
- Tests: `tests/delivery-loads.test.ts`, `tests/driver-execution.test.cjs`, `tests/driver-regression.cjs`, `tests/e2e/driver-execution.spec.ts`, `tests/e2e/load-integrity.spec.ts`, `tests/helpers/authority-route-harness.cjs`, `tests/helpers/execution-fixture.cjs`, `tests/load-integrity.test.cjs`, `tests/resource-authority.test.cjs`.
- Task entry: `docs/batch3-driver-execution.md`.
