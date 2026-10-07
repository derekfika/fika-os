# Autonomous launch UAT — 7 October 2026

Task: FIKA OS — Autonomous Launch UAT + Remediation War Room.
Branch: `main`. Starting fetched `origin/main`: `4948ed5730a2a090801407b86392f61a34cac595`.
Environment: staging only, Firebase project `fika-os-dev`.
RC achieved: **NO — CHECKPOINT / CLOSURE MODE**. No RC SHA frozen.
User requested closure below 10% usage. No further broad journey or new non-critical remediation is authorised during this checkpoint.
Latest fetched source `origin/main` at checkpoint construction: `d916c8d5e976da882553b25c7499762b316c4a51` (local HEAD identical before this report-only commit). The subsequent report-only checkpoint commit is identifiable in `git log`; its final HEAD/origin SHA is returned in the chat. No source change follows the validated CPU commit.

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
| 3 Hospitality → quote → CPU | NARROW LIVE REGRESSION PASS / AFFECTED FULL RETEST PENDING | Hospitality `03a8249`, Hub `1dd58ce`, CPU `d916c8d` | Owned prior booking retains £25 net addition, £201.60 gross quote, CPU handoff, 36 production pieces for 12 ordered portions | Hub change requires full owned amendment/cancellation downstream retest |
| 4 CPU / allergen safety | PARTIAL LIVE PASS / GATE PENDING | CPU initially `c35d6a9`, now `d916c8d` | Explicit synthetic unknown→contains/may_contain/clear review; checked checkpoint, both internal synthetic test-role signatures; normal retry yields current OPLOC release | Reopen/amendment revocation, signature/packet invalidation, immutable history and downstream withdrawal still pending; full current CPU suite 289/289 PASS |
| 5 Fulfilment → Logistics | PARTIAL LIVE PASS / GATE PENDING | Hub `1dd58ce`, Logistics `0fe3ec6` | Owned Monday Menu order appears as one Haleon/12-unit planning item | Assignment lineage, retry exactly-once and downstream amendment/cancellation live gates pending |
| 6 Logistics desktop | PARTIAL LIVE PASS / GATE PENDING | `0fe3ec6` | Normal owned delivery+collection creation, authorised Van 1 assignment, exact native timing edit, Ready without driver principal | Drag/move/cross-vehicle/resize/23:45/merged-clear-refresh/invalid-window live gates pending. Cleared-membership fix: CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING. Governed location picker defect open |
| 7 Grab & Go / Xchange | UNEXECUTED | Delivered `71b2860` | No new governed order chain exercised | Full required policy/order/downstream journey pending |
| 8 Owned amendment | CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING | Hub `1dd58ce` READY/current 100% | Atomic source/order/Fulfilment/outbox/audit regression coverage passes | Owned Hospitality amendment and retired downstream work verification next; no direct repair performed |
| 9 Owned cancellation / withdrawal | CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING | Hub `1dd58ce` READY/current 100% | Atomic cancellation and retry regression coverage passes | Owned Hospitality cancellation and Menu withdrawal/republish live checks pending |
| 10 Date / cache / retry | PARTIAL LOCAL/LIVE EVIDENCE / GATE PENDING | Mixed staging SHAs | Date fallback regression and scoped cache/authority/CAS tests pass; current release retry succeeds; completed driver state survives storage/reload | Mobile selected service date resets on reload (confirmed P1); broader BST/date/cache/retry live gates unexecuted |
| Driver execution | LIVE LIFECYCLE PASS / FULL GATE PENDING | Logistics `0fe3ec6` READY/current 100% | Existing authorised session → fixed `/mobile/van1` → selected owned run → assigned stops → loading → dispatch → delivery → collection → return → completed v10; durable completion verified | Reload loses non-today service-date selection; selecting 12 October restores persisted completed run. Real shared identity preparation and Van 2 live coverage remain; no individual accounts/grants created |
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

- **P0 source fixed, live unresolved:** Hospitality downstream retirement. CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING. Owned full amendment/cancellation live path was not begun in closure mode; pre-existing retired requirements/jobs remain unmodified and need a separately justified governed recovery path if still stale after the fixed workflow is proved.
- **P1 confirmed:** mobile non-today selected service date does not persist on reload (above).
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
