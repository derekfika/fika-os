# Autonomous launch UAT — 7 October 2026

Task: FIKA OS — Autonomous Launch UAT + Remediation War Room.
Branch: `main`. Starting fetched `origin/main`: `4948ed5730a2a090801407b86392f61a34cac595`.
Environment: staging only, Firebase project `fika-os-dev`.
RC achieved: **NO — AUTONOMOUS UAT RESUMED**. No RC SHA frozen.
The resume instruction supersedes the earlier closure-only scope. Continue the ordered UAT/remediation loop; automatically checkpoint if ordinary usage remaining falls below 10%.
Resume fetched `origin/main` and local HEAD: `d1c9e5d7cbb540def2b4882d69635315e60ea398` (report-only prior checkpoint). Protected hashes and all six staging provenance rows were reverified before continuing. The latest implementation commit and final HEAD/origin SHA are recorded below or returned in the chat following commit/push.

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

This matrix supersedes the earlier baseline matrix. Partial live successes do not constitute a complete journey PASS. The six-app final RC regression has not run.

| Journey | Status | SHA | Evidence | Remaining issue |
| --- | --- | --- | --- | --- |
| 1 Auth / launcher / OPLOC | PARTIAL LIVE PASS / GATE PENDING | Hub `1dd58ce` | Existing authenticated launcher, six app links, session reload and governed workspace entry load | Live invalid/missing scope, redirect and denial checks pending |
| 2 Menu → CPU → Delivered-In | PARTIAL LIVE PASS / GATE PENDING | Menu `0fd8714`, CPU `d916c8d`, Delivered `71b2860` | Catalogue/picker recovered; owned whole-week v1 published; Monday 12 portions materialised once into canonical CPU and visible Logistics queue | Delivered consumption, intentionally blank downstream days, withdrawal/republish, historical missing/corrupt package and stale-cache live checks pending; local recovery/integrity tests pass |
| 3 Hospitality → quote → CPU | OWNED LIVE AMENDMENT / CANCELLATION PASS | Hospitality `03a8249`, Hub `1dd58ce`, CPU `d916c8d` | Normal amendment 12→13 pax, £25 net addition retained, quote r3 £212.40; original 12/36 frozen history, replacement 13/39; normal cancellation and downstream withdrawal persist after reload | Exact-event live replay and separate historical retired-work recovery pending |
| 4 CPU / allergen safety | PARTIAL LIVE PASS / GATE PENDING | CPU initially `c35d6a9`, now `d916c8d` | Explicit synthetic unknown→contains/may_contain/clear review; checked checkpoint, both internal synthetic test-role signatures; normal retry yields current OPLOC release | Reopen/amendment revocation, signature/packet invalidation, immutable history and downstream withdrawal still pending; full current CPU suite 289/289 PASS |
| 5 Fulfilment → Logistics | PARTIAL LIVE PASS / GATE PENDING | Hub `1dd58ce`, Logistics `0fe3ec6` | Owned Monday Menu order appears as one Haleon/12-unit planning item | Assignment lineage, retry exactly-once and downstream amendment/cancellation live gates pending |
| 6 Logistics desktop | PARTIAL LIVE PASS / GATE PENDING | `0fe3ec6` | Normal owned delivery+collection creation, authorised Van 1 assignment, exact native timing edit, Ready without driver principal | Drag/move/cross-vehicle/resize/23:45/merged-clear-refresh/invalid-window live gates pending. Cleared-membership fix: CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING. Governed location picker defect open |
| 7 Grab & Go / Xchange | UNEXECUTED | Delivered `71b2860` | No new governed order chain exercised | Full required policy/order/downstream journey pending |
| 8 Owned amendment | HOSPITALITY LIVE PASS / EXACT REPLAY PENDING | Hub `1dd58ce` READY/current 100% | Old order amended v2; old requirement/job withdrawn v2; one replacement r12/39-piece queue item; all known outbox events delivered; reload retained state | Exact-event live replay pending; separate historical booking remains untouched |
| 9 Owned cancellation / withdrawal | HOSPITALITY LIVE PASS / MENU GATE PENDING | Hub `1dd58ce` READY/current 100% | Cancelled booking v14 and replacement order v2; replacement requirement/job withdrawn v2; projection revision 205/sequence 203 has zero owned queue/load items; reload does not resurrect work | Menu withdrawal/republish and exact-event live replay pending |
| 10 Date / cache / retry | NARROW DATE LOCAL/LIVE PASS / FULL GATE PENDING | CPU/Logistics `9aa2cba` | Both fixed van non-today service-date reloads retain permitted run; opposite-vehicle request revalidated; CPU Today/allergen default correct; BST/GMT/DST local boundary tests PASS | Broader cache/retry/concurrency live gates unexecuted |
| Driver execution | VAN 1 LIVE LIFECYCLE / RELOAD PASS; FULL GATE PENDING | Logistics execution `0fe3ec6`, reload `9aa2cba` READY/current 100% | Existing authorised session → fixed `/mobile/van1` → assigned stops → loading → dispatch → delivery → collection → return → completed v10; 12 October and completed stops survive reload | Real shared identity preparation, Van 2 execution and two-context concurrency remain; no individual accounts/grants created |
| CPU quantity correction | PASS — CODE / LOCAL / LIVE | CPU `d916c8d` READY/current 100% | Week card Production: 36 piece + 12 pax; detail 36 pieces to produce / 12 Per person ordered; Menu remains 12 portion | No remaining quantity defect observed in this narrow regression |

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
- P0 Hospitality: bounded 13 October state shows superseded/amended orders retaining pending fulfilment and Logistics work. Missing durable event staging was fixed, validated and deployed at `1dd58ce`; CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING. No direct operational repair performed; pre-existing retired records have not been repaired.
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
Style Guide compliance: PASS for the touched Logistics and CPU surfaces; existing components, styles and accessibility controls retained.
CHANGELOG updated: no — task-specific protection; this report is the task record.

## Hospitality durable downstream remediation validation

Amendment/cancellation now prepare all known-ID Fulfilment reads before staging any transaction writes, then atomically stage the requirement, receipt, Logistics outbox and domain event with the authoritative Hospitality order update. Retired Hospitality handoffs map to withdrawn fulfilment while their frozen production snapshots remain amended history. Ordinary CPU amendments retain their existing semantics. Replay preserves prior audit evidence. Destination reconciliation now retains the prior requirement audit when creating its superseding destination requirement.

Focused provider/workflow regressions: **49/49 PASS**, including four isolated cancellation/amendment/retry tests. Hub typecheck and production build PASS. Full Hub baseline executed **480 tests, 464 pass, 16 fail**; three relevant failures were subsequently fixed and included in the focused 49-test pass. Remaining failures are baseline assertions/fixtures outside this remediation; full suite is not claimed green. A final full-suite attempt failed before execution with `uv_os_get_passwd ENOMEM` in tsx (zero tests). Deployment is verified below; affected full live journey remains pending.

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

Validation: focused quantity/projection/day regressions **26/26 PASS**; full CPU suite **289/289 PASS** with `NODE_ENV=test npm test`, ensuring isolated memory storage. Replaced a missing mutable local-data allergen fixture with a deterministic committed legacy fixture; refreshed stale assertions against the inspected master-sign, lineage/revocation and owner-diagnostic contracts. The materialisation retry test now creates an actual CPU delivery obligation and controls the test clock while asserting backoff and recovery of the same event. Typecheck and production build PASS. Style Guide compliance: PASS; existing components/styles retained. CPU deployment and narrow live card/detail regression PASS at exact `d916c8d5e976da882553b25c7499762b316c4a51`.

Owned 12 October Menu UAT reached both synthetic internal test-role signatures. The normal retry action completed its OPLOC materialisation; the UI reports both signatures recorded and every scoped release current. Screenshot `artifacts/uat/owned-allergen-release-current.png`. Revocation/persistence checks remain pending. No real staff signature or live delivery was impersonated.

## Closure checkpoint — authoritative current staging

Read-only App Hosting current traffic/build metadata checked after the CPU rollout: all rows below READY/current 100%. These are deliberately mixed source commits; **no aligned six-app RC exists**.

| App / backend | Exact current source SHA | Current build / rollout |
| --- | --- | --- |
| Hub / `fika-os-staging` | `1dd58cef24b43cba01761abdf5bbb601632ebbc4` | `uat-1007081108-1dd58ce` |
| Menu / `fika-menu-planning-staging` | `0fd871416ecb548202f6be3c20a75f7d5867253b` | `uat-1007075039-0fd8714` |
| Hospitality / `fika-hospitality-staging` | `03a8249d3639f38c3c87eac3ea24f7b1e14a77f8` | `build-2026-10-06-002` |
| CPU / `fika-cpu-production-staging` | `d916c8d5e976da882553b25c7499762b316c4a51` | `uat-1007084549-d916c8d` |
| Delivered-In / `fika-delivered-in-staging` | `71b2860ac572894d7df6979430ea326edfba0ce1` | `build-2026-10-05-002` |
| Logistics / `fika-logistics-staging` | `0fe3ec6526d7b43d1221ff9b55f195901e9b1c88` | `uat-1007083007-0fe3ec6` |

CPU build was submitted successfully, but the immediate rollout request initially returned build-not-found while registration was asynchronous. Once the same exact build was registered, its rollout was submitted without creating a duplicate build: operation `projects/fika-os-dev/locations/europe-west4/operations/operation-1791359186854-65d3b4fff6136-81a525e1-8eccf676`. Current metadata subsequently proved READY/100%. No rollout was inferred live from submission alone.

### Every implementation commit pushed today

1. `0fd871416ecb548202f6be3c20a75f7d5867253b` — Fix catalogue source hash ordering and legacy package recovery.
2. `5e5cd36c7f22c806617f3d0f7697d46ecfbb3ee2` — Preserve cleared Logistics load membership through reconciliation.
3. `1dd58cef24b43cba01761abdf5bbb601632ebbc4` — Stage Hospitality withdrawal and cancellation downstream atomically.
4. `0fe3ec6526d7b43d1221ff9b55f195901e9b1c88` — Execute Logistics runs with shared session vehicle authority.
5. `d916c8d5e976da882553b25c7499762b316c4a51` — Show configured CPU production quantities separately from ordered portions.

The report-only commit is titled **Save autonomous launch UAT closure checkpoint**. It adds no implementation or deployment change. Final local HEAD and freshly fetched origin/main are reported in the chat after successful push.

### Active Logistics operation completed

Actual staging flow, at verified `0fe3ec6`: existing authorised account → `/mobile/van1` → select 12 October and Van 1 run → inspect owned assigned stops → confirm delivery loaded → Dispatch vehicle → Mark delivered → Collection complete → Confirm returned to CPU. No driver identity selected or driver grant/account created. Before loading, delivery completion was disabled. After completion the UI shows **completed**, **2/2 total stops completed**, zero remaining deliveries/collections and zero attention. Normal reload plus reselecting 12 October shows the same completed state. Direct known-ID staging read confirms run version **10**, status **completed**, vehicle **van1**, updated `2026-10-07T07:52:43.054Z`; both owned stop records are completed.

Important limit: reload resets the service date to today (7 October) while the URL retains the 12 October run ID. It then shows NO WORK until 12 October is reselected. Durable execution state persists, but selected-date persistence fails. This is a confirmed **P1**, so the full driver launch gate remains open. No new remediation begun in closure mode.

Exact owned records for safe continuation:

- Menu week: `rolling-week:2026-10-12`; publication `menu-publication:rolling-week:2026-10-12`, v1; Monday publication day `menu-publication:rolling-week:2026-10-12:v1:day:0`.
- Menu canonical CPU order: `production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`; Firestore document hash `d97f18434e5bd5b165df40d48fdde04e98c047866f003b9cfdb5133ef97ee25b`.
- Allergen release: `cpu-allergen-release:2026-10-12:menu-publication:rolling-week:2026-10-12:v1:day:0:v1`; the corresponding materialisation delivery ID is `cpu-allergen-materialize:cpu-allergen-release:2026-10-12:menu-publication:rolling-week:2026-10-12:v1:day:0:v1:oploc:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:order:production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`.
- Hospitality owned booking: `booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`; portal `MNK-20261006122750-BFD2`, Completed, 13 October 12:00. Use this clearly marked UAT record for the governed reopen/amend/cancel workflow. Do not silently edit the separate original booking `booking:mnk:86ee28f023384fde1245816b9b595244`.
- Logistics owned run: `run:2026-10-12:van-1` (completed v10). Van 2 run `run:2026-10-12:van-2` was not executed.
- Owned delivery movement: `movement:1791359068176` — FIKA-AUTOUAT-20261007 Driver delivery.
- Owned collection movement: `movement:1791359274129` — FIKA-AUTOUAT-20261007 Driver collection.
- Delivery stop: `stop:run:2026-10-12:van-1:movement%3Amovement%253A1791359068176%3Aendpoint:1791359236769` (completed v5).
- Collection stop: `stop:run:2026-10-12:van-1:movement%3Amovement%253A1791359274129%3Aendpoint:1791359309324` (completed v3).

Evidence screenshots (ignored local artifacts, not repository source): `artifacts/uat/shared-session-run-completed-0fe3ec6.png`, `artifacts/uat/cpu-quantity-card-d916c8d.png`, `artifacts/uat/cpu-quantity-detail-d916c8d.png`, `artifacts/uat/owned-allergen-release-current.png`, `artifacts/uat/owned-week-published.png`. Corresponding test/build logs are under `artifacts/uat/autolaunch-*`.

### Remaining P0 / P1 and unexecuted work

- **P0 historical downstream retirement unresolved:** owned Hospitality live amendment/cancellation now PASS at Hub `1dd58ce`; pre-existing retired requirements/jobs for the separate historical booking remain unmodified. They require a separately justified governed recovery path; do not erase evidence or directly repair operational state.
- **P1 mobile service-date reload:** FIXED / LOCAL AND NARROW LIVE PASS at `9aa2cba`; both fixed van routes retain 12 October and their own run after reload.
- **P1 confirmed UI omission:** New movement shows “Integration Hub locations are unavailable” and an empty governed-site selector while the day health indicates OPLOC availability. Source inspection shows `projectionToDashboardData` deliberately returns `oplocs: []`, so the form lacks a reference catalogue. One-off request-scoped destinations were used for the owned execution UAT. No fake permanent OPLOC created. No fix begun; trace/restore the governed reference read with admission checks, explicit failure/retry and bounded/cache-aware behaviour.
- **P1 cleared-membership remediation:** CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING for real merged clear/refresh/reassign.
- **Safety gate still pending:** allergen signed-release amendment/revocation and downstream packet withdrawal; passing dual-sign/materialisation does not prove revocation safety.
- **Unexecuted full gates:** Grab & Go/Xchange; Delivered populated/blank/withdraw/republish/historical recovery/integrity/client-cache scenarios; auth denial/redirect; comprehensive timeline interaction/rejection/end23:45; BST/date/retry/concurrency live coverage; final same-SHA six-app RC regression. Root Golden Week tests passed locally, but no full Golden Week cloud fixture was run or permitted.

### Human preparation and environment

No engineering decision is waiting for Derek at this checkpoint. The final shared Logistics AUTHMOD account still needs formal governed identification/configuration before a launch using that account. Do not repurpose person identity `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7` without independent confirmation. Existing-session UAT is authorised; account preparation does not remove driver execution from RC scope. Do not create individual driver logins or person driver grants for UAT.

Windows sandbox limitations: Git metadata writes, generated build files and Playwright launch needed trusted unsandboxed execution; tsx sometimes failed with `uv_os_get_passwd ENOMEM` before executing tests. Logistics used the existing per-file isolated TypeScript loader (201 tests) plus native CJS route tests (232), total 433 PASS; Chromium E2E 8 PASS. CPU standard unsandboxed `NODE_ENV=test npm test` ultimately executed all 289 successfully. Earlier fallback CPU run had unsupported loader cases and is not the authoritative full-suite result. Set NODE_ENV=test explicitly for memory-store tests; do not depend on tsx retaining `--test` in process.argv. Hub full-suite pass remains unproven as described above. Firebase CLI login is separately expired; refreshed gcloud account and official App Hosting API succeeded. No tokens/secrets belong in artifacts or handoff.

Local emulator `demo-fika-os` on port 8085 and local Logistics server port 3900 were used only for isolated tests; stop those task-started processes at closure and restart explicitly when needed. Browser staging tabs are marked for handoff. No background automation was created.

### Exact next task and execution order

**First fresh-session task:** fetch origin, verify protected hashes and exact current Hub staging SHA, then execute the governed **Reopen and amend booking** workflow for owned Hospitality booking `booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`. Verify old production snapshot retention plus atomic withdrawn/superseded Fulfilment, durable Logistics outbox/consumer convergence and stable audit/retry evidence; then cancel the replacement through the normal UI and verify downstream removal. Do not directly rewrite staging state or touch the separate original booking.

Next: remediate mobile service-date reload persistence with scoped vehicle/run revalidation, test a non-today run, deploy an exact validated main SHA and live retest both van routes. Restore governed movement location selection, then complete pending desktop merged-clear/drag/resize/rejection gates. Finish allergen revocation and Menu/Delivered withdrawal/blank/cache/recovery gates, Grab & Go and remaining scope/date/retry coverage. Only after every required journey passes, align all six apps to one validated exact SHA and run the final RC regression. Do not freeze based on source/tests alone.

Protected hashes must remain the initial values above. Final check/push/fetch/HEAD verification is required before returning. CHANGELOG updated: **no**, explicit task protection; this report is the durable task record.

**CHECKPOINT SAVED — SAFE TO RESUME AUTONOMOUS UAT**

## Resume evidence — owned Hospitality gate, 7 October

Existing authenticated session and normal product commands only. Owned booking
`booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76` was amended from 12 to 13 guests/portions
with a uniquely marked reason. The five-stage UI regenerated quote/PDF, handed off
the replacement to CPU and reconciled Logistics. Quote r3 is £177 net, £35.40 VAT,
£212.40 gross, including the unchanged £25 net addition. Booking v13 was Sent to CPU.

Original Production ID `production-order:v1:booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`
became amended v2 and retained its frozen 12-customer/36-production snapshot.
Replacement ID `production-order:v1:booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76:r12`
was needs_review v1 with quote r3, 13 customer portions and 39 production pieces.
The original Fulfilment and Logistics records became withdrawn v2; their original
audit evidence was retained. Projection revision 201/sequence 200 contained exactly
one owned current queue item (replacement r12), with no owned loads. Known old v1/v2
and replacement v1 Logistics outbox events were delivered.

Normal Cancel booking used an explicit UAT reason and **Request production cancellation**.
No Calendar removal was requested. Staging has no FIKA_EMAIL_WEBHOOK_URL: the existing
notification command records a queued obligation and sends no email. No secret or
notification configuration was changed. Cancellation at 11:42:10Z yielded booking
Cancelled v14 and replacement Production cancelled v2. Original amended history
was unchanged. Replacement Fulfilment and Logistics became withdrawn v2 and its
v1/v2 outbox events were delivered. Known audit document
`booking_mnk_2fdaea9b9ddbddf136163f3a5a11cd76:14` records workflow-cancel.

Exact Fulfilment IDs are `fulfilment-requirement:cpu-production:<Production ID>:oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f`
for the two literal Production IDs above. Corresponding Logistics IDs are
`logistics-job:<Fulfilment ID>`. Source withdrawals, rather than historical deliveryStatus,
determine current work. Reloaded Hospitality retains Cancelled/13 pax/£212.40;
refreshed and reloaded Logistics has four unrelated historical items and no owned
39-piece item. Direct known-day projection revision 205/sequence 203 confirms
ownedQueue=0 and ownedLoads=0. No duplicate replacement was observed.

**PASS:** owned amendment, immutable prior snapshot, current replacement lineage,
durable downstream invalidations, cancellation and reload persistence.
**Pending:** live exact-event replay; local idempotency/replay tests already pass.
No delivered event was reset merely to manufacture replay evidence. The separate
older booking `booking:mnk:86ee28f023384fde1245816b9b595244` remains untouched.
Evidence: ignored `artifacts/uat/resume-amendment-*.json`, `resume-cancellation-*.json`,
`resume-hospitality-amended.png`, `resume-hospitality-cancelled.png`,
`resume-logistics-cancelled-reloaded.png`. All reads used known IDs or bounded queries.

Next active task: validate, commit and deploy the confirmed Logistics mobile service-date
reload and CPU Today/allergen London-date fixes, then narrow live retest both fixed
van routes. The earlier first-fresh-session Hospitality instruction above is superseded.

## Resume remediation — mobile date / CPU UK date

Mobile hydration now restores a strictly validated YYYY-MM-DD serviceDate query;
malformed/impossible calendar dates fall back to the actual London date. Selecting
a new day clears prior run selection and date-scoped transient state. Restoration
waits for current projection/vehicle admission and only selects a run belonging to
the permitted fixed vehicle and requested day. The URL persists valid date even
on an empty day; no driver account or grant was added. Existing server access/CAS
and scoped projection/cache coordinator remain unchanged.

CPU Production Day Today and default Allergen Review date now use the existing
europeLondonDate helper. They retain actual weekends rather than using the dashboard's
next-working-day convention. Explicit supplied allergen dates remain unchanged.

Validation: mobile calendar/BST/GMT/DST focused 2/2 PASS; CPU boundary/wiring 3/3
PASS. Full Logistics 435/435 PASS (203 isolated TS + 232 CJS), full CPU 290/290
PASS. Both typechecks and webpack production builds PASS. Chromium browser suite
10/10 PASS including shared-session execution, both fixed van non-today reloads,
opposite-vehicle requested-run rejection and empty-date reload without stale run.
Initial local Turbopack could not resolve existing cross-root modules; trusted
webpack dev runner executed the browser tests successfully with demo-fika-os and
emulator configuration. All API data was intercepted by isolated browser fixtures.
Generated declarations/test-run metadata were restored; local task server stopped.
Style Guide compliance: PASS, existing UI semantics/styles retained.

**CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING.** Deploy only the exact
validated pushed SHA to CPU and Logistics; verify READY/current 100%, then retest
non-today fixed van reload and CPU Today/allergen defaults. No RC is frozen.

### Date fixes — deployment and live evidence superseding pending status

Commit pushed: `9aa2cba7d901fd1a69f97d465852758a560abd49`.
CPU `uat-1007125522-9aa2cba` and Logistics `uat-1007125529-9aa2cba` verified
READY/current 100%, source exactly this SHA. Other staging apps retain the mixed
SHAs in the prior provenance table; no six-app RC exists.

Live existing-session Van 1 selects 12 October, completed run v10, and reloads
with serviceDate=2026-10-12 plus the same canonical run and two completed stops.
Fixed Van 2 given Van 1 vehicle/run query values revalidates to its own
`run:2026-10-12:van-2`, retains 12 October after reload and displays zero assigned
stops. This is scope/date evidence, not a Van 2 execution PASS. CPU Day Previous
then Today returns to Wednesday 7 October; default /allergens uses 2026-10-07.
Actual staging clock used; synthetic midnight/DST coverage is local only.
**PASS:** narrow date regression. Evidence: `mobile-van1-date-reloaded-9aa2cba.png`,
`mobile-van2-date-reloaded-9aa2cba.png`, `cpu-today-9aa2cba.png`,
`cpu-allergen-date-9aa2cba.png` in ignored artifacts/uat.

## Resume remediation — governed movement location selector

Root cause: compiled day projection intentionally carries no OPLOC catalogue, yet
the movement form consumed its empty oplocs array. The form now lazily requests a
dedicated server endpoint when opened. Admission uses the same both-vehicle shared
planner authority required to create unassigned movements, before any reference read.
The endpoint reuses Hub's existing integrity-checked canonical OPLOC read package,
accepts at most 1,500 valid reference rows and fails explicitly for empty/invalid/
unavailable data. Labels remain display only. Existing save-movement independently
revalidates canonical IDs against governed Hub references; one-off addresses retain
request-scoped identity. No access or grants changed.

Read shape: no catalogue call during ordinary dashboard load; one coalesced call
per opened form, plus explicit retry. Hub's existing compiled-package/manifest path
serves current references; no new Firestore collection scan, listener or periodic
catalogue polling introduced. Missing/stale derived-package recovery remains the
existing Hub provider behaviour; integrity failure remains fail-closed. Close/reopen
revalidates references instead of retaining a cross-session client catalogue.

Validation: focused real-route 4/4 PASS (missing/single-vehicle denial before upstream,
one canonical read/zero operational queries or writes, invalid/bounded/outage/retry,
label-as-ID rejection and canonical save). Full Logistics 439/439 PASS (203 TS +236
CJS), typecheck and production webpack build PASS. Eight existing browser authority/
date tests PASS; two new rendered movement tests PASS after correcting ambiguous
test locators (select label includes option text; Next.js owns a second alert).
New browser tests prove lazy one-call reference load, stable-ID submission and
outage→explicit retry→populated picker. No product test skipped. Task local server
stopped and generated files restored. Style Guide compliance: PASS; existing light
form/styles and semantic buttons/status/alert retained.

**CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING.** Commit/push, deploy
Logistics only at the exact validated SHA, then narrow real governed picker/save
regression using owned UAT work. CPU remains current at `9aa2cba`.

## Full Hub suite — exact remaining baseline failures

Trusted `NODE_ENV=test npm test` against isolated local demo-fika-os Firestore
executed **480 tests: 467 PASS, 13 FAIL**, zero skips. This supersedes the earlier
ENOMEM/zero-test limitation; full Hub is not green. Initial resume attempt was
stopped because the required local emulator was absent (one Firestore test waited
279 seconds); that environment run is not the authoritative result. Emulator was
then started without any cloud import/export and the complete suite executed.
Raw local evidence: `artifacts/uat/resume-hub-full-emulator.log`. Exact failure names
and diagnostic errors below retain the assertions without reproducing enormous
source-code strings printed as their Input/actual values.

| Exact failed test | Exact error / assertion | Location / disposition |
| --- | --- | --- |
| ADDR-001 is Accepted and LOC-003 remains authoritative and unchanged | `Error: ENOENT: no such file or directory, open 'C:\Fika\fika-os\fika-platform-specs\docs\business-decisions\addr-001-canonical-address.md'` | address-workflow.test.ts:80; missing external specification dependency |
| canonical boundary exposes published OPLOCs only with type filters and deterministic pagination | `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` actual `[]`, expected `['oploc:a']` | canonical-boundary.test.ts:11; pending investigation |
| completeness register covers restricted and unknown BrightHR fields | `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:` `assert.ok(BrightHrCompleteness.some(field => field.fieldId === "brighthr:start-date" && field.classification === "unknown-investigation"))` | canonical-governance.test.ts:26; pending investigation |
| tests\connections-home.test.ts | `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css" for C:\Fika\fika-os\apps\integration-hub\app\ui\MenuRoutingPanel.css`; runner `'test failed'` | Node CSS import unsupported; legitimate test adapter still needed |
| service and allocation actions require explicit confirmation and support restoration | `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /window\.confirm/. Input:` | connections-lifecycle-actions.test.ts:25; stale native-dialog assertion conflicts with Style Guide |
| Delivered-In synthetic access is explicit and OPLOC-ID based | `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` actual `[]`, expected `['oploc:46701265-15af-48f4-a230-1d27ca21bc59']` | delivered-in-access.test.ts:13; pending fixture/contract investigation |
| decommissioned OPLOCs never enter Delivered-In access | `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` actual `[]`, expected `['Haleon', 'FIKA Xchange']` | delivered-in-access.test.ts:24; pending investigation |
| integration admins receive all active canonical OPLOCs | `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` actual `[]`, expected `['oploc:46701265-15af-48f4-a230-1d27ca21bc59']` | delivered-in-access.test.ts:32; pending investigation |
| Logistics admission route has one stable server trace boundary | `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /resolveUserAccess\(new FirestoreAuthModRepository\(\), \{ principal, appId: "logistics" \}\)/. Input:` | logistics-admission-trace.test.ts; current shared evaluation context differs; pending assertion review |
| bounded Logistics outbox recovery has an explicit scheduler pattern | `Error: ENOENT: no such file or directory, open 'C:\Fika\fika-os\apps\docs\deployment\integration-hub-logistics-outbox-scheduler.md'` | logistics-replay-boundaries.test.ts:18; relative path corrected as part of recovery validation; retest pending |
| Service Definition steady-state GET reads the package; canonical reads remain rebuild-only | `AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /rebuildServiceDefinitionsReadPackage/. Input:` | service-definitions-read-package.test.ts:28; provider missing-package semantics require investigation |
| package misses require explicit authenticated rebuild instead of synchronous GET reconstruction | `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /z\.enum\(\["oplocs", "service-arrangements", "service-definitions", "authmod-references"\]\)/. Input:` | service-definitions-read-package.test.ts:57; current dataset list differs; pending review |
| cancel creates no mutation and saves refresh both views | `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /type="button" onClick=\{close\}>Cancel/. Input:` | site-staffing.test.ts:277; pending current modal/refresh assertion review |

Do not mark any unresolved assertion PASS merely because it looks stale. Verify
the current contract and replace stale coverage with meaningful invariants where
appropriate; do not reinstate prohibited native dialogs or broaden access.

## Location picker — narrow live evidence and new label defect

Logistics commit `898b0c9da2e2233bfea185f2858e35f78879c2ee` pushed and build
`uat-1007130519-898b0c9` verified READY/current 100% exact SHA. Real staging form
loaded 19 governed locations. Normal save selected canonical Haleon
`oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`, 1 item named
`FIKA-AUTOUAT-20261007-VAN2 governed delivery`, 12 October 14:00–14:30, uniquely
marked staging-only notes. Exact new record `movement:1791375509831` is open v1,
created/updated at 2026-10-07T12:18:29Z. No real delivery or notification occurred.

**PASS:** governed picker load and canonical normal save. **New confirmed P1:**
the planning queue labels this saved canonical movement “Unknown governed destination”.
Trace its projection/label path; preserve the stable OPLOC and movement IDs, use
governed display metadata, and do not join or authorise by label. This movement is
owned Van 2 UAT preparation; it has not been assigned/executed yet.

## Exact Hub Logistics dead-letter recovery remediation

The normal worker intentionally excludes dead letters. A new administrator-only
exact-event lookup/replay endpoint and `/logistics-recovery` review surface support
one reviewed recovery, with no bulk reset. Existing Integration Administrator and
canonical.edit admission precede any event read. POST requires one event ID, UUID
command reference, reason, expected attempts and exact reviewed dead-letter timestamp.
The transaction reads only event+command audit IDs, checks stale review/state and
atomically resets the existing event with an immutable before/after delivery audit.
Payload, ID, source version, correlation and source history remain unchanged.
Normal leasing/bounded worker delivery resumes outside that atomic reset; a process
or network failure therefore leaves a durable retry obligation. Same command retry
is idempotent; a different command/actor/reason/state conflicts. Original failure
evidence remains in `fikaLogisticsProjectionReplayAuditV1`.

Validation: focused real-route/service 8/8 PASS; directly affected Hospitality/
Fulfilment/reconciliation/outbox provider regressions 27/27 PASS, including those
eight. Typecheck and production webpack build PASS. Isolated rendered Chromium
checks PASS for denied admission, reviewed one-event scope, required reason, uncertain
response retry retaining the same UUID/body, delivered feedback and 44px purple/
white semantic controls. New local review page uses shared FIKA tokens; Style Guide
compliance PASS. The old scheduler-document regression had a wrong relative path
and an assertion that rejected Markdown line wrapping; both corrected and PASS.
Final full Hub suite: **488 tests, 476 PASS, 12 FAIL, zero skips**. The eight new
recovery tests pass and the scheduler-document test now passes; the other 12 exact
baseline names/errors above persist with no new failures. Evidence:
`artifacts/uat/resume-hub-recovery-full-final.log`. Unresolved baseline failures
remain RC gates; full Hub is not claimed green.

**CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING.** Commit/push only
after the completed baseline comparison, deploy Hub staging at the exact validated SHA,
then review a known event under the existing authorised session. Do not reset a
delivered event or invent a dead letter to manufacture a live PASS. If no owned
reviewable dead letter exists, keep actual reset/delivery live retest pending.

## Governed movement labels and Hub recovery live review

Baseline origin/main: `3446d5d9b58a5bd363e5655ec74a460bc3ce565d`.
Hub build `uat-1007132239-3446d5d` is verified READY/current/100% at that exact SHA.
Existing authorised administrator reviewed the owned cancellation event
`logistics-projection:2026-10-13:cpu-production:production-order:v1:booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76:r12:oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f:v2`
on `/logistics-recovery`. PASS: exact lookup displays Delivered, source version 2,
13 October, attempts 0, and no reset control. Read-only bounded query of at most
10 existing dead letters returned zero. Actual dead-letter reset/delivery remains
LIVE RETEST PENDING; no delivered event was reset or failure manufactured.
Evidence: `artifacts/uat/recovery-owned-delivered-3446d5d.png` and
`artifacts/uat/resume-dead-letter-review.json`.

The confirmed movement queue label defect is fixed in source. Logistics owns the
optional endpoint display snapshots; Hub's provider contract is unchanged. Normal
movement creation derives labels server-side from canonical IDs and ignores client
labels. Planner rendering consumes snapshots only as display fallback. Existing
movements recover labels in their derived day projection using reconciliation's
already-required bounded Hub reference read, without rewriting authoritative
movement versions or audit history. Ordinary mutation rebuilds retain labels only
when movement and endpoint IDs match, with no extra upstream read. No full reference
catalogue is stored in a day projection; normal vehicle scope filters the movement
and its labels together. New and old records remain compatible.

Validation: Logistics **441/441 PASS** (203 isolated TypeScript + 238 CJS), zero
skips; typecheck and production webpack build PASS. New real-route/materialisation
regressions cover forged client labels, historical recovery without authoritative
rewrite, same-name distinct IDs, no unrelated reference leakage, retained labels
without upstream reread, unchanged reconciliation without a projection rewrite,
endpoint replacement, and vehicle-only denial of unassigned movement metadata.
Style Guide compliance PASS: existing light planner rendering retained.
**CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING.** Deploy Logistics
only at the resulting exact validated commit, refresh/reconcile owned
`movement:1791375509831`, then verify Haleon label and persistence before Van 2 UAT.

## Movement inspection and ordinary legacy display follow-up

Pushed `d107e6066918aa1e16d0930f9bc03af23863459f`; Logistics build
`uat-1007133321-d107e60` verified READY/current/100%. Narrow live retest showed
ordinary Refresh is a projection reread, not maintenance reconciliation. Therefore
the old unassigned owned movement still lacked display snapshots until a real
canonical reconciliation; this is not called live PASS.

Follow-up source adds one lazy, admitted `/api/logistics/locations` package read
only when a legacy projection lacks movement endpoint labels. Display joins use
canonical IDs and do not rewrite authoritative history or projection state.
Resolved labels remain in mounted view across normal refreshes; no catalogue
polling or extra reads for current snapshotted movements. Failure is explicit
with a governed retry button. Endpoint admission remains both-vehicle authority;
no security scope is expanded. Server-derived snapshots continue to serve new work.

New live P1 also confirmed: normal mouse click on movement Details did nothing.
The control incorrectly reused a double-click-only card handler. Details and Set
time now invoke inspection directly; keyboard activation of the movement card is
supported while its pointer drag/double-click behaviour remains intact.

Validation: final isolated rendered Chromium authority suite **12/12 PASS**, zero
skips, including single-click Details, keyboard card, Set time, lazy historical
label recovery with one read across refresh, no history mutation, and zero label
reads for snapshotted movements. Initial new test incorrectly counted the normal
idempotent ensure-vehicle-day-runs command as an inspection mutation; assertion
corrected to exclude that existing bootstrap. Final typecheck/build PASS. The
prior 441 domain/authority regressions passed for d107; no business mutation or
server authority code changes in this UI follow-up. Style Guide compliance PASS.
**CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING.** Deploy this resulting
exact Logistics commit and retest the same owned record, then execute Van 2.

Recovery infrastructure reconnaissance found Cloud Scheduler API disabled in
`fika-os-dev` and zero jobs. Under the authorised staging-only configuration scope,
API enabled successfully (operation
`operations/acf.p2-594727519934-b3530bd3-279b-4e50-b8a3-55bf933cbfa3`). Both deployed
worker apps bind existing `FIKA_INTERNAL_API_TOKEN@3`; no secret version, login
account or IAM grant created/changed. Documented 25-event/minute recovery jobs are
being configured using that existing token. Job creation, enabled/authenticated
invocation and controlled retryable-obligation recovery must each be verified;
API enablement alone is not a recovery PASS.
