# RCoA grouped amendment and completion UAT fixes

Date: 2026-10-15. Starting main and staging source:
`1c19a7739ed17a36598c64d6840ba1b8f5f0cab2`.
Both staging backends were verified against this exact SHA before diagnosis:
Hub `build-2026-10-15-010` and Hospitality `build-2026-10-15-011`, both READY /
SUCCEEDED, 100% traffic, and matching Artifact Registry / Cloud Run digests.
No staging deployment is part of this fix task.

## Root causes

`HospitalityGroupDetail` explicitly rendered “Group editing and cancellation
are not available.” The single-booking amendment command existed, but there was
no group command to authorize, version-check and commit all services together.
Running that command sequentially from a group UI would allow half an amendment.

`projectBookingGroup` reduced child `lifecycleStatus` values to a Set and returned
“Partially processed” whenever more than one value existed. CPU handoff can mark
those services Completed while in-house services remain Quoted. That valid mix
therefore stayed partial forever, even after CPU signing and matrix persistence.
The projection never consulted current CPU plan/release evidence. Conversely,
all children being Completed could imply completion before allergens were ready.
The regression fixtures reproduce this exact mixed-status mechanism; no customer
record needed to be changed to diagnose it.

## Governed amendment

The operator opens one **Amend booking** form, edits shared customer/reference,
event name and date details once, and edits the existing service times, guests,
locations, on-site contacts, requested items/options, quantities, dietaries and
notes within that form. There are no per-service lifecycle/save/handoff actions.
An amendment reason is required. Controls remain keyboard accessible, saving is
locked against double submission/navigation, and loading/saving/errors are labelled.

The editor loads fresh members using a known-group read, bounded to 13 documents
(12 members plus overflow sentinel). It does not reread an entire dashboard and
is not restricted to its default future-date window. Both read and mutation
routes require the existing actor/session and site mutation authorization.

The Hub owns the mutation. A single Firestore transaction:

1. Reads and validates exact membership, shared OPLOC, group/source identity and
   the current commercial source hash. Every member's expected version is checked.
2. Authorizes the shared governed scope; cancelled services cannot be reopened.
3. Validates dates/times in Europe/London, including the spring DST gap, service
   windows, quantities and duplicate requested Item IDs.
4. Prepares changed services with the same amendment implementation used by the
   single-booking workflow. Unchanged services keep their identity/version/state.
   Changed services increment booking/commercial versions, return to Reviewed,
   retain submitted source/history, and mark old quote revisions stale.
5. Reads canonical routing for changed services inside the transaction. Missing
   or conflicting routing rejects the entire amendment, before any write.
6. Prepares existing order/requirement retirement and durable CPU/Fulfilment/
   Logistics events. All reads finish before any writes. Previous Production
   Orders become explicitly amended, with incremented versions and audit evidence;
   their requirements are cancelled using the existing canonical semantics.
7. Commits changed bookings, per-service audit evidence, one group audit record,
   and downstream events atomically. Delivery is attempted after commit; the
   existing durable events retain retry/reconciliation evidence if delivery fails.

No CPU database or Drive artifact is edited directly. Old quote snapshots and
order snapshots remain historical evidence. Existing CPU lineage checks reject
old signed releases after order retirement/version changes, even while a projection
delivery is pending. An updated group quote and explicit Send to CPU create the
replacement through the existing revision-aware handoff, not a new lifecycle system.
Unchanged handed-off services retain their existing order when group quote
sections are reissued without changing their operational commercial version.
The existing Completed-booking commercial-charge compatibility remains supported.

A stale/lost-response retry conflicts and requires refresh; it cannot duplicate
bookings or Production Orders. A no-op amendment creates no revisions/events.
Grouped transactions fail closed above 50 historical orders or requirements per
changed service, or above three active handoffs/requirements per changed service.
These additional group write-budget guards do not change legacy single-booking
amendment limits.

The existing service roster/group identity is retained. Adding/removing requested
items is supported; adding/removing service blocks is not introduced here. Group
cancellation is deferred because it requires a separate governed withdrawal command
and UX. Individual service amendment/cancellation cannot bypass group consistency.

## Required-work completion rule

One shared Hub-owned pure roll-up is used by the Hub projection and Hospitality's
server adapter. Hub supplies canonical routing and current order/quote linkage.
Hospitality obtains current release evidence from CPU's **existing** bounded
`reviewStatus=1&orderIds=...` API. That API already verifies release/signature
authority against the current canonical order; no new CPU endpoint is needed.

“Completed” requires a current, fully persisted group quote and resolved routing.
For every CPU-required service it additionally requires:

- a successful, current handoff with a matching quote/operational version;
- CPU plan status planned and completed allergen review;
- both production-chef and head-chef/site-manager signature roles;
- a ready current matrix release;
- matching production-order ID, booking ID, quote revision and CPU source revision.

CPU source revision is not confused with mutable order version: CPU's existing
release verifier binds the latter into its source hash. In-house services have
no CPU requirement and do not hold a group open. An entirely in-house booking
completes once its group quote is current. Menu-template and email/send-quote
configuration do not participate in this rule, so the deliberate RCoA menu
deferral and disabled customer email are nonblocking.

| State | Meaning |
|---|---|
| New | Resolved request without a group quote |
| Awaiting routing | Missing, conflicting or unknown production routing |
| Awaiting quote / Quote preparing | Stale or unfinished commercial evidence |
| Ready for CPU | Required handoffs have not started |
| Partially processed | Some required CPU services are handed off; others remain |
| Sent to CPU | All required handoffs exist; current signed/reviewed output is unfinished |
| Needs attention | Failed/blocked/reconciliation state, failed matrix, unavailable CPU evidence or mixed cancellation |
| Completed | All required work above is satisfied |
| Cancelled | All services are cancelled |

No child-status count can force completion. Reload rederives the state from
current authoritative evidence; revoked, stale, missing or failed evidence cannot
remain falsely Complete. Retired/stale orders cannot enable artifact controls.
Matrix/menu lookups clear old readiness/URLs while checking, and late responses
from a previous version or selection cannot restore stale current pointers.

## Read/write and compatibility shape

Amendment reads only the known group, affected booking/order/requirement
aggregates and requested canonical routing/merge IDs. Source hashes, all member
versions and transactional routing reads preserve concurrency guarantees. There
are no catalogue/routing writes, whole-collection scans, cross-week reads or new
polling loops. Menu reference loading uses the existing site/OPLOC catalogue path.

CPU evidence is fetched only for quote-current groups whose required handoffs all
exist. IDs are deduplicated and batched in sets of 25, with at most the workspace's
existing 200-booking bound. CPU reads only those requested orders/plans with its
existing Hub enrichment/authorization. Cold and warm refreshes use the same bounded
shape; terminal completion is not cached across revocation. The existing visible
dashboard refresh interval is unchanged. No progress projection is persisted and
successful reads do not generate audit writes.

Shared DTO additions are derived at read time, so historical groups require no
backfill. Single-service lifecycle and quote/run-sheet/Drive contracts remain in
place. Group quote regeneration preserves the existing Sent to CPU / Completed
states of unchanged handed-off services instead of offering duplicate handoffs.

## Validation and deployment recommendation

- Hospitality: 203/203 tests, including group completion/reload, the actual
  dashboard API batch adapter, rendered amendment action/options, RCoA all-day,
  CPU orchestration, quote/run-sheet/Drive and single-service regressions.
- Hub: 178/178 affected tests, with disposable `demo-fika-os` Firestore emulator
  at `127.0.0.1:8905`; group amendment, concurrency/rollback, multiple-order date
  amendment, no-op, unresolved routing, identity/version preservation, frozen
  quote history, replacement/retry safety, grouped quote and cross-app UAT enabled.
- CPU: 29/29 release, Hospitality signing lineage, bounded review API, matrix-view
  and materialisation/integrity regressions. CPU source is unchanged.
- Both affected app typechecks and production builds passed; `git diff --check`
  passed. The final task report records the committed source SHA.
- Style Guide compliance: PASS. Shared semantic tokens, light surfaces, visible
  focus, labelled fields and 44px controls; no deliberate visual deviation.

Recommend a coordinated **Hub + Hospitality** staging deployment after approval,
Hub first. No CPU or unrelated app deployment is required. Nothing was deployed
in this task. All mutation tests used isolated emulator data and mocked external
adapters. No staging/production catalogue migration, routing-review mutation,
customer artifact creation, customer email enablement or production access occurred.

## Changed file manifest

- `CHANGELOG.md`
- `apps/hospitality-booking/app/api/booking-groups/amend/route.ts`
- `apps/hospitality-booking/app/api/dashboard-bookings/route.ts`
- `apps/hospitality-booking/app/ui/GroupAmendmentEditor.tsx`
- `apps/hospitality-booking/app/ui/HospitalityDashboard.tsx`
- `apps/hospitality-booking/app/ui/HospitalityGroupDetail.module.css`
- `apps/hospitality-booking/app/ui/HospitalityGroupDetail.tsx`
- `apps/hospitality-booking/lib/cpu-production-plan.ts`
- `apps/hospitality-booking/lib/group-progress.ts`
- `apps/hospitality-booking/tests/group-amendment-ui.test.ts`
- `apps/hospitality-booking/tests/group-cpu-production.test.ts`
- `apps/hospitality-booking/tests/group-lifecycle-route.test.ts`
- `apps/hospitality-booking/tests/group-lifecycle.test.ts`
- `apps/hospitality-booking/tests/hospitality-group-dashboard.test.ts`
- `apps/integration-hub/app/api/hospitality-booking-groups/amend/route.ts`
- `apps/integration-hub/app/api/hospitality-bookings/route.ts`
- `apps/integration-hub/lib/booking-workflow.ts`
- `apps/integration-hub/lib/hospitality-booking-service.ts`
- `apps/integration-hub/lib/hospitality-group-amendment.ts`
- `apps/integration-hub/lib/hospitality-group-commercial.ts`
- `apps/integration-hub/lib/hospitality-group-projection.ts`
- `apps/integration-hub/lib/hospitality-group-quote-workflow.ts`
- `apps/integration-hub/tests/hospitality-group-amendment.test.ts`
- `apps/integration-hub/tests/hospitality-group-quotes.test.ts`
- `apps/shared/hospitality-group-lifecycle.ts`
- `apps/shared/hospitality-group-quotes.ts`
- `docs/architecture/hospitality-group-amendment-lifecycle.md`
