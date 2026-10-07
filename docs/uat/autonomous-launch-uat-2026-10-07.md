# Autonomous launch UAT — 7 October 2026

Task: FIKA OS — Autonomous Launch UAT + Remediation War Room.
Branch: `main`. Starting fetched `origin/main`: `4948ed5730a2a090801407b86392f61a34cac595`.
Environment: staging only, Firebase project `fika-os-dev`.
RC achieved: **NO — UAT in progress**. No RC SHA frozen.

The task-specific protected-file instruction overrides the normal CHANGELOG rule.
`CHANGELOG.md` and `sites/mnk/booking-platform/01_MenuData.js` remain unstaged and
uncommitted user changes. Neither may be altered. Initial SHA256 verification:

- CHANGELOG: `4691AC53FF895F84701B476129018065ED8F4F1D766DC458E706BD455201E81D`.
- MenuData: `7A5C0D3664799ED88D7BF1473683F2A6EFCC6FBA9232B3B32C1E139C364D1636`.

## Baseline evidence

Fetch and `git pull --ff-only origin main` completed; main already up to date.
Only the two protected user files were dirty at entry. No clone or worktree created.
Read root/nested guidance, logging strategy, readiness scan, style guide,
cost rules, existing Hospitality closure and actual package scripts.
This is UAT/remediation, not the formal forensic audit/readiness scan.

The in-app browser has an authenticated staging session. Launcher displays the
existing Integration Administrator and all six core app links. No authority changed.

| Core app | Baseline served SHA | Provenance | Status |
| --- | --- | --- | --- |
| Integration Hub | `b1e6e16fa738cdce588c357813d1549cd5946366` | App Hosting current traffic, build-2026-10-05-001 READY 100% | Authenticated launcher loads |
| Menu Planning | `71b2860ac572894d7df6979430ea326edfba0ce1` | Live `/api/build-info` | Different from baseline |
| Hospitality | `03a8249d3639f38c3c87eac3ea24f7b1e14a77f8` | Current traffic, build-2026-10-06-002 READY 100% | Existing UAT booking persists |
| CPU | `c35d6a9b8b0a86c2aa27297559081ba919543b97` | Live `/api/build-info` | Different from baseline |
| Delivered-In | `71b2860ac572894d7df6979430ea326edfba0ce1` | Live `/api/build-info` | Different from baseline |
| Logistics | `9f716c651b4af3ecf94917d1812aa0cb2633b767` | Current traffic, build-2026-10-06-002 READY 100% | Planner and mobile load |

The first sandboxed build request had NETWORK_ERROR; unsandboxed execution
reached the live endpoints. No product defect inferred from the sandbox failure.
Initial GCP authentication expired; Derek refreshed his existing login. Current
App Hosting traffic and build metadata now verifies every baseline SHA above.
Menu and Delivered-In: build-2026-10-05-002; CPU: build-2026-10-06-002, all READY at 100%.

## Journey matrix

Pending rows are explicitly unexecuted and do not claim PASS.

| Journey | Status | SHA | Evidence | Remaining issue |
| --- | --- | --- | --- | --- |
| 1 Auth / launcher / OPLOC | In progress | Hub unverified | Authenticated launcher and app links visible | Refresh, site scope and denial checks |
| 2 Menu → CPU → Delivered-In | FAIL — AUTOFIXING | Per-app baseline above | Dish Library consistency error; 398 authoritative dishes, hash mismatch | Catalogue fix validated locally; live deployment/retest pending |
| 3 Hospitality → quote → CPU | Not executed | Per-app baseline above | Prior closure retained | Lightweight deployed regression |
| 4 CPU / allergen safety | Not executed | CPU baseline above | None in this run yet | Review/signature/revocation gates |
| 5 Fulfilment → Logistics | Not executed | Unverified | None in this run yet | Stable downstream state |
| 6 Logistics desktop | Not executed | Unverified | None in this run yet | UI interaction gates |
| 7 Grab & Go | Not executed | Delivered-In baseline above | None in this run yet | Governed order chain |
| 8 Amendment | Not executed | Unverified | None in this run yet | Owned UAT record |
| 9 Cancellation / withdrawal | Not executed | Unverified | None in this run yet | Owned UAT record |
| 10 Date / cache / retry | Not executed | Unverified | None in this run yet | Smoke gates |
| Driver execution | FAIL — AUTOFIXING | Logistics baseline | No person-bound logistics.driver grants; Ready/Dispatch and mobile selection currently depend on them | Latest business requirement: shared authorised Logistics session, vehicle/run selection and execution. Driver execution remains an RC gate; no individual accounts or new driver grants. |

## Validation

- `npm run test:uat`: **12/12 PASS**, no skipped tests.
- `npm run uat -- builds --expected 4948ed5730a2a090801407b86392f61a34cac595 --json`:
  executed; three live build SHAs captured, Hub explicitly unavailable.
- Baseline CPU suite: 276/285 pass, 9 failures. Logistics: 419/427 pass, 8 failures. Menu: 207/208 pass, 1 invalid-date fallback failure. No failed test silently skipped.
- Menu after fix: `NODE_ENV=test npm test` **211/211 PASS**, `npm run typecheck` PASS, `npm run build` PASS.
- Logistics cleared-load route regressions: **100/100 PASS**; delivery-load unit regressions **5/5 PASS**; complete suite **429/429 PASS**, no skips. `npm run typecheck` and `npm run build` PASS. Seven baseline stale assertions were updated to the already-present mounted timeline, scoped request/cache coordinator and arrival-only normalization. No source change was made to satisfy retired UI assertions. Deployed UI retest pending.

Menu remediation commit pushed: `0fd871416ecb548202f6be3c20a75f7d5867253b`.
App Hosting staging build/rollout `uat-1007075039-0fd8714` submitted for Menu only;
current/live verification completed: READY/current 100%, exact `0fd871416ecb548202f6be3c20a75f7d5867253b`. Dish Library and picker recovered. Firebase CLI's separate login remains expired;
submission used the same official API payloads with the refreshed existing GCP account.

## Remediation in progress

- P0 catalogue: the source hash depended on Firestore map key ordering. Staging source revision 5, 398 dishes; stored hash `f636d8ec42a4e30d31d95253daf5db812416744ba0b5552fe7ff47b5b781e338` versus freshly read `2baa9d7cbaffd788a99799239aed00b640e0981b183b0ef4934e55de53c8fb2c`. Canonical recursive key ordering now certifies identical records deterministically. Existing legacy manifests receive a transactionally certified metadata-only revision; authoritative dishes and immutable packages remain unchanged. Corrupt packages are rejected before any recovery/migration. Cold legacy recovery reads one manifest and at most 1,500 dish records; warm current reads retain the existing package/manifest path with no catalogue scan. Migration is coalesced per process and idempotent across instances.
- P1 Logistics: clearing delivery timing retained durable assignments but projection filtering discarded them; routine reconciliation could then erase membership. Existing unscheduled membership now survives projection/reconciliation and can be rescheduled with CAS; new assignment and dispatch retain strict arrival constraints. Source identity/location/date changes and withdrawals still invalidate membership.
- P0 Hospitality: bounded 13 October state shows superseded/amended orders retaining pending fulfilment and Logistics work. Tracing the workflow confirmed missing durable fulfilment event staging on amendment/cancellation. Fix in progress; no direct operational repair performed.
- Invalid Menu week-query input ignored its explicit fallback date; fixed while validating date navigation, retaining Europe/London business-date semantics.
- Driver business requirement confirmed by Derek: authentication belongs to the shared authorised Logistics operator; operational driver/run/vehicle identity is separate. Earlier out-of-scope decision is superseded. Remove the person-login dependency from execution while retaining canonical vehicle ownership, scoped server authorization, CAS and audit actor evidence.

## UAT records and live observations

Normal UI created planning week `rolling-week:2026-10-12` and published v1.
The owned `FIKA-AUTOUAT-20261007-ALPHA Salad` was added through the normal catalogue/planner UI; Monday has 12 portions for canonical Haleon `oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`. Whole-week publication shows Published v1. Other weekdays remain intentionally blank; downstream checks pending.
No customer/internal notification sent. Existing yesterday UAT Hospitality record
`booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`, portal `MNK-20261006122750-BFD2`, retains £25 net additional charge, current £201.60 gross quote and CPU handoff. CPU 13 October shows **36 pieces / 12 people**. No browser hydration #418 observed. Current week explicitly empty; next week contains two Hospitality jobs.
Original booking `booking:mnk:86ee28f023384fde1245816b9b595244` has order revisions base/r9/r13/r17; old work is excluded in CPU but remains downstream. Existing records were inspected without edits.

## Integrity

Production untouched. No reset, direct staging deletion, identity repair,
permission broadening, secret change, or Golden Week cloud mutation performed.
Style Guide compliance: PASS for inspected launcher; no UI edit yet.
CHANGELOG updated: no — task-specific protection; this report is the task record.

## Hospitality durable downstream remediation validation

Amendment/cancellation now prepare all known-ID Fulfilment reads before staging any transaction writes, then atomically stage the requirement, receipt, Logistics outbox and domain event with the authoritative Hospitality order update. Retired Hospitality handoffs map to withdrawn fulfilment while their frozen production snapshots remain amended history. Ordinary CPU amendments retain their existing semantics. Replay preserves prior audit evidence. Destination reconciliation now retains the prior requirement audit when creating its superseding destination requirement.

Focused provider/workflow regressions: **49/49 PASS**, including four isolated cancellation/amendment/retry tests. Hub typecheck and production build PASS. Full Hub baseline executed **480 tests, 464 pass, 16 fail**; three relevant failures were subsequently fixed and included in the focused 49-test pass. Remaining failures are documented baseline assertions/fixtures outside this remediation; full suite is not claimed green. A final full-suite attempt failed before execution with `uv_os_get_passwd ENOMEM` in tsx (zero tests); no repeated environmental retry. Staging deployment and affected full live journey remain pending.

Logistics commit `5e5cd36c7f22c806617f3d0f7697d46ecfbb3ee2` pushed; staging build/rollout `uat-1007075545-5e5cd36` verified READY/current 100% exact SHA.
Hub remediation `1dd58cef24b43cba01761abdf5bbb601632ebbc4` pushed; staging build/rollout `uat-1007081108-1dd58ce` verified READY/current 100% exact SHA. Affected full live amendment/cancellation retest pending.

## Shared Logistics session remediation

Driver execution is an RC gate. The final shared AUTHMOD identity has not yet been created/identified; Derek explicitly authorises live UAT with the current authorised session. Account setup remains launch preparation, without repurposing an unconfirmed person identity. Staging has two active vehicle grants (van1/van2) for one person identity and no operational-identity vehicle grants. No account or grant changed.

Ready/Dispatch no longer require a physical driver's person-bound grant. Current/proposed canonical run, stop and load ownership remains transactionally authorised against the authenticated operator's existing vehicle scope. Loading, source freshness, timing, issues, CAS and completion checks remain mandatory. Audit records the executing operator separately from preserved optional historical driver metadata.

Desktop selects permitted vehicles through a session-scoped vehicle endpoint, without depending on the driver grant catalogue. Mobile selects stable vehicle/run IDs; fixed `/mobile/van1` and `/mobile/van2` views preserve server request scope. URL selections are revalidated against current permitted vehicles and available runs; selection never grants access. UI no longer represents a vehicle/driver as the signed-in account.

Validation: focused real-route execution/authority **111/111 PASS**; full app **433/433 PASS** via 201 isolated TypeScript source tests and 232 CJS route tests. Standard tsx runner failed before test execution with the documented Windows `uv_os_get_passwd ENOMEM`; the existing diskless loader was extended to resolve workspace TS package exports and preserve per-file process isolation. No failed product test skipped. Typecheck and production build PASS. Isolated Chromium E2E **8/8 PASS**: shared-session multi-job delivery/collection/return, merged execution/undo, creation without a driver, missing vehicle authority denial, readiness without driver identity, historical metadata preservation, fixed vehicle scope, and reload selection persistence. Initial sandbox browser launch EPERM; unsandboxed trusted runner executed, then an ambiguous test locator was corrected and all eight passed. Live staging retest pending.

Read shape: vehicle endpoint reuses normal Hub admission/vehicle evaluation; zero driver-grant or workforce catalogue reads. Desktop/mobile issue a single coalesced cold authority request and explicit retry. No new periodic listener/polling was added; normal scoped projection cache/head cadence is retained.

Logistics shared-session remediation `0fe3ec6526d7b43d1221ff9b55f195901e9b1c88` pushed; build/rollout `uat-1007083007-0fe3ec6` verified READY/current 100% exact SHA. Actual staging driver execution is in progress using owned Logistics movements and the existing authorised session.

## CPU production quantity correction

P1 confirmed: the CPU week card summed customer quantities beneath a production pieces/quantities label (12 instead of the canonical 36 pieces for the Hospitality UAT order). The card now labels configured production quantities explicitly, totals matching units only, retains unlike units separately and shows unconfigured lines without inferring production from customer portions. Customer quantities and pax remain separate. No authoritative operational data or shared contract changed.

Validation: focused quantity/projection/day regressions **26/26 PASS**; full CPU suite **289/289 PASS** with `NODE_ENV=test npm test`, ensuring isolated memory storage. Replaced a missing mutable local-data allergen fixture with a deterministic committed legacy fixture; refreshed stale assertions against the inspected master-sign, lineage/revocation and owner-diagnostic contracts. The materialisation retry test now creates an actual CPU delivery obligation and controls the test clock while asserting backoff and recovery of the same event. Typecheck and production build PASS. Style Guide compliance: PASS; existing components/styles retained. CPU deployment pending.

Owned 12 October Menu UAT reached both synthetic internal test-role signatures. The normal retry action completed its OPLOC materialisation; the UI reports both signatures recorded and every scoped release current. Screenshot `artifacts/uat/owned-allergen-release-current.png`. Revocation/persistence checks remain pending. No real staff signature or live delivery was impersonated.
