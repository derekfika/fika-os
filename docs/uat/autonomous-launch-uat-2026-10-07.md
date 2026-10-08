# Autonomous launch UAT — 7 October 2026

Task: FIKA OS — Autonomous Launch UAT + Remediation War Room.
Branch: `main`. Starting fetched `origin/main`: `4948ed5730a2a090801407b86392f61a34cac595`.
Environment: staging only, Firebase project `fika-os-dev`.
RC achieved: **NO — G&G AND FULL ALLERGEN LIFECYCLE PASS; GATES3–5/OTHER RC GATES OPEN**. No RC SHA frozen.
Latest continuation is the 8 October resume section below. The withdrawal consumer
acceptance remains PASS; older stop/resume instructions are historical checkpoints.
The resume instruction supersedes the earlier closure-only scope. Continue the ordered UAT/remediation loop; automatically checkpoint if ordinary usage remaining falls below 10%.
Resume fetched `origin/main` and local HEAD: `d1c9e5d7cbb540def2b4882d69635315e60ea398` (report-only prior checkpoint). Protected hashes and all six staging provenance rows were reverified before continuing. The latest implementation commit and final HEAD/origin SHA are recorded below or returned in the chat following commit/push.

The task-specific protected-file instruction overrides the normal CHANGELOG rule.
`CHANGELOG.md` and `sites/mnk/booking-platform/01_MenuData.js` remain unstaged and
uncommitted user changes. Neither may be altered. Initial SHA256 verification:

- CHANGELOG: `4691AC53FF895F84701B476129018065ED8F4F1D766DC458E706BD455201E81D`.
- MenuData: `7A5C0D3664799ED88D7BF1473683F2A6EFCC6FBA9232B3B32C1E139C364D1636`.

## Autonomous resume — 8 October 2026: Grab & Go Scheduler / owned live chain PASS

Starting fetched `origin/main` = local HEAD = **`3ad6f39872410f4198e4232d7f761a303d8470ab`**, branch `main`.
Only protected CHANGELOG/MenuData edits were dirty; both documented SHA256 values
match. No clone/worktree, account/grant change or production action. Ordinary usage
at entry: 98% five-hour remaining / 55% weekly remaining. The new session checkpoint
threshold is approximately 15%; no new major gate below that threshold.

Authoritative resume is the **e4dddbe** withdrawal consumer acceptance. Delivered-In
already contains and serves durable G&G source/outbox implementation; do not redeploy
the older ceaff01 checkpoint. Next gate remains the bounded Delivered G&G recovery
Scheduler and one owned non-Xchange submit/amend/cancel/reload/exact replay chain.

### Local SQLite regression diagnosis and correction

Reproduced Delivered-In full baseline **130 tests / 129 PASS / 1 FAIL**, zero skips.
The named corruption-recovery test neither creates the claimed preserved JSON source
nor checks recovered records: `length >= 0` would accept data loss. The store correctly
returns 503 when corrupt SQLite has no recovery source. This is a test-fixture/coverage
defect, not a proven hosted runtime defect.

Moved the three SQLite regressions to an isolated loader fixture with a unique temporary
directory per test and cloud access mocked to throw. No developer local-data is used.
Five tests prove expected-version conflict, unlocked outbox consumer, exact order/history
recovery from a valid preserved JSON source, original corrupt-byte backup preservation,
and fail-closed behavior for absent or invalid recovery source. Replaced timer-based
consumer sequencing with a deterministic entry/release barrier. Hosted source unchanged.

Validation: isolated SQLite **5/5 PASS**; full Delivered-In **132/132 PASS**, zero skips,
`NODE_ENV=test npm test`; `npm run typecheck` PASS; webpack `npm run build` PASS.
Restricted runner first denied the temporary recovery rename (EPERM) and SWC workspace
canonicalization before build; the same isolated tests and build pass outside the
restricted runner. These are explicit runner limitations, not claimed initial passes.
Logs: `artifacts/uat/oct08-delivered-tests.log`, `oct08-delivered-typecheck.log`,
`oct08-delivered-build.log`. Test/report-only correction needs no staging deployment.
Final diff/protected checks and exact commit/push result are recorded after validation.

### Cloud/browser preparation

Normal staging Hub entry retains the existing authorized Integration Administrator
session. Delivered-In entry and normal navigation to G&G respond using that session.
No operational source mutation performed yet; withdrawn Menu week remains untouched.
GCP CLI credential refresh initially required
normal identity verification. That verification reached Google Cloud SDK consent;
automatic approval review rejected the Allow action because the consent exposes broad
SDK Cloud/App Engine/Compute/Cloud SQL access. Explicit owner approval was requested;
no workaround or auth bypass was used. Owner explicitly approved SDK consent and normal
sign-in completed. No credential values are included in this evidence.
Passed Menu/Hub journeys were not repeated.

### Verified staging provenance and bounded recovery worker

At **2026-10-08T03:03:12–14Z**, all six backend builds READY, matching rollouts
SUCCEEDED, current traffic100%, not reconciling. Source SHA/build:

| App | SHA | Build |
| --- | --- | --- |
| Hub | `c0a41ae3fe60393d20fc810fa6f0c1dacbe48b0f` | `uat-1007193534-c0a41ae` |
| Menu | `06181e4b50262fb505396fbc5080ad9907b6bcce` | `uat-1007182022-06181e4` |
| Hospitality | `03a8249d3639f38c3c87eac3ea24f7b1e14a77f8` | `build-2026-10-06-002` |
| CPU | `e4dddbe0164ce295a447eea7803ebea278e6e8ca` | `uat-1007200425-e4dddbe` |
| Delivered-In | `e4dddbe0164ce295a447eea7803ebea278e6e8ca` | `uat-1007200422-e4dddbe` |
| Logistics | `ec1b11029beb5c03e7e68cb54c1ca55cc6fbac85` | `uat-1007134501-ec1b110` |

Public Menu/CPU/Delivered build-info responses corroborate those SHAs. The initial
provenance reader incorrectly treated traffic splits as rollout references; the actual
field is build. That diagnostic was corrected before accepting any provenance result.
Evidence `oct08-start-provenance.json`, `oct08-runtime-build-info.json`.

Created staging-only `projects/fika-os-dev/locations/europe-west4/jobs/fika-delivered-in-grab-and-go-outbox-recovery`;
ENABLED, every minute, Europe/London, POST friendly staging `/api/internal/grab-and-go-outbox`,
limit25, existing `FIKA_INTERNAL_API_TOKEN@3`,180s deadline/3 retries/30–300s backoff.
No IAM/secret/app-config change. Manual initial invocation HTTP200 at03:03:54.773Z;
subsequent scheduled invocations HTTP200. Existing Hub/CPU/Menu workers remain enabled.
No failed event was manufactured: owned commands delivered normally, so live evidence
is accepted Scheduler invocation plus source/downstream convergence; failure/lease/backoff
recovery is covered by the isolated hosted regression, not claimed live fault injection.
Evidence `oct08-grab-scheduler-created.json`, `oct08-grab-scheduler-invocations.json`.

### Owned non-Xchange live journey

Normal authorized G&G UI selected **One Angel Court**, canonical
`oploc:24a93500-d75d-4fe0-8beb-672d36f9da10`, Monday **2026-10-12**, rotation4.
Known-ID reads proved no source/event/canonical/downstream record before creation.
The new source `grab-and-go:oploc:24a93500-d75d-4fe0-8beb-672d36f9da10:2026-10-12`
is owned by this UAT. Product `grab-250ml-greek-yoghurt-raspberry-goji-coconut-chia`.
No FIKA Xchange mutation and no republish of the withdrawn Menu week.

| Normal UI stage | Source version/status/quantity | Canonical Production | Fulfilment / Logistics | Source event delivery |
| --- | --- | --- | --- | --- |
| Submit | v1/submitted/2 | v1/sourceVersion1/planned/2/audit1 | v1/sourceVersion1/ready_for_planning/2/audit1 | delivered03:05:56.194Z |
| Amend | v2/submitted/3 | v2/sourceVersion2/planned/3/audit2 | v2/sourceVersion2/amended/3/audit2 | delivered03:08:21.962Z |
| Cancel | v3/cancelled/3 retained history | v3/sourceVersion3/cancelled/audit3 | v3/sourceVersion3/withdrawn/audit3 | delivered03:09:34.190Z |

Production stable ID is `production-order:v1:grab-and-go:<sourceId>:<oplocId>`;
Fulfilment `fulfilment-requirement:grab-and-go:<sourceId>:<oplocId>`;
Logistics `logistics-job:<fulfilmentId>`. Exact expanded IDs/payloads retained in snapshots.
Events exactly `production.materialise:<sourceId>:v1`, `:v2`, `:v3`, all delivered.
Source history preserves all3 transitions and quantity snapshots2/3/3. Bounded source-ID
queries prove exactly **one Production, one Fulfilment, one Logistics job** after each
accepted version; stable line/product identities preserved.

CPU visible Monday card showed One Angel Court/G&G/2 then3; canonical day projections
rev7/seq665 then rev8/seq666 matched. Logistics planning queue showed One Angel Court
G&G2 READY, then3 with upstream-amendment attention. Normal refresh/reload retains
the source amendment. Cancellation produces CPU day rev9/seq667 with owned orders0,
Logistics withdrawn job, no owned assignment/load work. Normal cancelled-source retry
is delivered and does not rewrite source or downstream history.

Exact immutable older **v1** payload replayed through existing authenticated staging
Hub `/api/production/materialise`, no event/history reset. HTTP200 in1419ms,
duplicate=true/created=false, returned current cancelled Productionv3/sourceVersion3/audit3,
CPU and Logistics handoff delivered. Canonical sorted comparisons of source, Production,
Fulfilment, Logistics, CPU owned day projection and all3 outbox events are identical
before/after replay+UI retry; CPU revision/sequence remains9/667. No duplicate/resurrection.
Relevant apps reloaded after cancellation/replay. No direct Firestore mutation/repair.
Evidence `oct08-grab-before.json`, `submitted-confirmed.json`, `amended.json`, `cancelled.json`,
`stale-replay.json`, `final.json`, `no-resurrection.json` (all under `artifacts/uat`).

### Non-blocking observation and next gate

G&G UI displays07:00–10:30 delivery information; existing external Production fallback
uses serviceWindow00:00/requiredBy08:00, while the G&G Fulfilment adapter intentionally
omits readyAt/requiredDeliveryWindow. This is **P2 operational presentation/policy clarity**:
planning currently sets delivery time explicitly; no source-date or canonical chain failure
was found. Do not reinterpret the UI text as a new enforced scheduling policy or amend
shared fulfilment constraints without owner clarification. No runtime change made for it.

**Gate 1 PASS:** Delivered SQLite full regression green; bounded staging recovery job
accepted; owned source→Production→CPU→Fulfilment→Logistics submit/amend/cancel/retry/replay
converges with stable IDs/history and no resurrection. Test/report correction pushed as
`c8f919589713204960ac2978ed2137abb4852cf2`; no application rollout needed or submitted.
**Next required gate: allergen signed-release correction/revocation and downstream withdrawal.**
No full launch/RC/P0-P1-zero assertion. CHANGELOG remains unchanged under explicit user
protection; this dated report is task evidence. No UI change; existing styles preserved.

### Gate 2 — owned allergen revocation: confirmed P0, local fix validated; staging retest pending

Gate1 acceptance report pushed as `8f8450620420968fa4b85a535021b69850d75efb`.
Normal G&G HTTP evidence: submit201/7.268315s, amend200/4.057012s,
cancel200/4.360015s, cancelled-source retry200/0.480389s (`oct08-grab-http.json`).

The former12 October signed fixture is authoritatively withdrawn and was preserved.
Known-ID read proved `rolling-week:2026-10-19` absent. Normal Menu UI **Start blank week**
created that separate owned week; selected existing `Fika-Autouat-20261007-Alpha Salad`
for Monday, saved2 Haleon portions, published whole weekv1; four other weekdays remain
published blank. No catalogue/recipe mutation or change to the withdrawn12 October week.
Owned canonical Production:
`production-order:v1:menu-planning:rolling-week:2026-10-19:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`.

CPU normal UI reviewed milk CONTAINS/tree_nuts MAY_CONTAIN, explicitly confirmed the
remaining12 unknown named states as CLEAR and checkpointed the row. Two **staging-test**
signatures used names `FIKA UAT PRODUCTION CHEF`/`FIKA UAT HEAD CHEF` via ordinary drawn
signature pads and existing authorized session. No real staff signature/real service
impersonated, no new role/grant/account. Existing normal OPLOC release retry completed
materialization; release **`cpu-allergen-release:2026-10-19:menu-publication:rolling-week:2026-10-19:v1:day:0:v1`**
became current/ready; Delivered release head published.

Normal **Reopen for amendment** removed CPU current signatures/release and preservedv1
as revoked history with both signatures valid=false. Delivered receipt/head eventType
revoked/resultapplied. Milk CONTAINS and nuts MAY_CONTAIN retained. Gluten correction
to CONTAINS cleared checked state until explicit re-check; correction saved, no new
signatures. Horizontal table scrolling was required to bring the gluten cell into view;
earlier offscreen locator clicks caused no source mutation.

**Confirmed P0:** normal Delivered-In19 October navigation and hard reload still show
Signed by CPU and the old signed PDF link after accepted revocation. Consumers verify
immutable gzip/source bytes but never consult revoked release authority; revocation
reconciliation can therefore enrich/recompile from the same old signed package, and
current cached projections also retain the obsolete signed status. This is not a
source-history rewrite or integrity corruption. Do not re-sign merely to hide it.

Bounded Delivered-In fix checks deterministic receipts for the exact release bound to
the bundle, covering both direct and durable delivery IDs. A processing/failed/applied
revocation receipt remains a permanent veto even after a newer head is published.
Both daily packet and cached projection ordinary read paths reject that revoked signed
authority, letting existing bounded Menu-only recovery retain the operational menu
without old signed PDF/allergen clearance. Integrity is verified before the veto;
corruption remains fail-closed, immutable bytes/receipts unchanged, and legacy bundles
without CPU release IDs retain their compatibility path. No source/shared contract,
CPU producer, permission, scheduler or recurring polling change.

Read shape: at most **two known revocation receipt document reads** for a release-bearing
signed packet/projection, no collection query; absent release identity addszero reads.
No read failure is swallowed; malformed scope fails503. No write added to successful reads.

Regression reproduces old signed packet authority before fix; initial fixture omission
of publishedAt was corrected before the meaningful failure. Final tests cover pending
revocation-before-reconciliation, immutable packet/projection preservation, independently
signedv2 acceptance, oldv1 blocking after a later published head, integrity failure,
two-ID hosted read budget and read/scope fail-closed behavior. Focused consumer8/8 PASS
before the additional hosted test; final full Delivered **134/134 PASS**, zero skips;
CPU affected release/durable-provider/integrity **19/19 PASS** with memory store;
Delivered typecheck/build PASS; final diff review/check and protected hashes PASS.
Logs `oct08-revocation-before.log`, `focused.log`, `full.log`, `provider.log`,
`typecheck.log`, `build.log` (all under `artifacts/uat`, prefix `oct08-revocation-`).

Evidence: `oct08-allergen-checkpoint.json`, `first-signature.json`, `both-signed.json`,
`materialized.json`, `revoked.json` under `artifacts/uat` with prefix `oct08-allergen-`;
CUA live snapshots/screenshots in this session. UI/source styling unchanged.

**Current gate status: P0 FIXED/LOCAL VALIDATION PASS/STAGING LIVE RETEST PENDING.**
Implementation committed/pushed as **`99c1ce04943c7704b9cd850159e08f103d915dd3`**,
HEAD=origin/main verified. Only Delivered staging rollout submitted:
`uat-1008043726-99c1ce0`; build operation
`operation-1791430646149-65d4bf34db01d-9b96152d-50ba093f`, rollout operation
`operation-1791430646374-65d4bf3512000-5ccef336-f163896a`.
No queued rollout is claimed current before live verification.
Verify READY/SUCCEEDED/current100%/not reconciling
and runtime SHA, then reload the still-revoked owned19 October condition **before**
new signatures. Confirm no old signed PDF or clearance. Then finish corrected dual
re-sign/new-release propagation/history and stale replay, with final clean owned withdrawal
if safe. No Gate3 or RC started. Protected files remain excluded.

### P0 staging acceptance and 15% usage checkpoint — 8 October 2026

At **03:41:30.852Z**, Delivered-only build `uat-1008043726-99c1ce0` is **READY**,
rollout **SUCCEEDED**, current traffic **100%**, **not reconciling**, source exactly
**`99c1ce04943c7704b9cd850159e08f103d915dd3`**. Public `/api/build-info` returns
the same literal SHA. CPU/Hub/Menu/Hospitality/Logistics were not redeployed.
Evidence `oct08-revocation-rollout-status.json`, `oct08-revocation-served-sha.json`.

**Original safety failure retest PASS before any replacement signatures:** normal
Delivered-In reload at Haleon/week19/day19 now retains Published Menuv1,1 dish/2 portions,
but shows **Awaiting CPU sign-off**, with **zero old signed checker PDF links** and no
old signed allergen clearance. Second reload retains that state. No republish/re-sign,
outbox reset or direct data repair was used to hide the defect. Existing bounded recovery
rejects the revoked cached projection and constructs a safe Menu-only view. Current
CPU plan remains unsigned; Delivered head remains revoked; corrected GLUTEN CONTAINS,
MILK CONTAINS/TREE_NUTS MAY_CONTAIN are saved. Signedv1 matrix/signature evidence and
master/packet hashes match the earlier current release; only revoked authority metadata
changes. Evidence `oct08-allergen-corrected-unsigned.json`, `post-deploy-revoked.json`,
`history-integrity.json` (prefix `oct08-allergen-` under `artifacts/uat`). CUA snapshots
and screenshots retain the browser evidence in this session.

**New P0 revoked-read defect: FIXED / LOCAL AND ORIGINAL STAGING RETEST PASS.**
**Gate2 overall: PARTIAL; corrected dual re-sign, independently materialized replacement,
downstream replacement/current-pointer coherence and exact older CPU-release replay
still pending.** Do not claim full Gate2/launch/RC acceptance from this narrower P0 pass.

Usage at03:40 checkpoint read was **14% five-hour remaining / 42% weekly remaining**.
Per the user's15% threshold, finished only the already-started atomic P0 fix/build/rollout
and original live retest. No replacement signatures, new architectural remediation,
Gate3 timeline, Gate4 AUTHMOD/Hub or Gate5 historical regression started below threshold.
Final report-only commit follows; it does not change implementation or served source.

**Exact next action for a fresh session:** fetch/verify HEAD=origin/main and protected
hashes; verify Delivered still serves99c1ce0. Continue owned19 October CPU matrix at
`/allergens?date=2026-10-19`: allsites,1 owned dish/1 OPLOC, corrected row checkpointed,
no signatures/current release, v1 revoked in history. Finish two clearly marked UAT
signatures through the existing normal pads, materialize a **new** release identity/version,
verify current replacement in CPU/Delivered-In, preservev1 history and exercise exact
older published/revoked event replay without resurrecting old clearance. Do not sign as
real staff, add authority, change recipe/catalogue or mutate the preserved withdrawn
12 October Menu week. The19 October source is intentionally still published as an
owned in-progress fixture with its canonical CPU/Fulfilment/Logistics lineage; do not
mistake that expected active test work for an orphan or delete it. Retire it by normal
owned withdrawal only after the remaining gate is proved and evidence retained.

Then proceed Gate3→Gate4→Gate5 in the new prompt order; earlier remaining RC/P1/history
gates remain open. G&G gate and SQLite baseline are green and should not be repeated
without affected-source evidence. No RC frozen; production untouched. Protected-file
SHA256 checks match both documented hashes. Only the two protected edits remain dirty
after report commit; no tests/workers or rollout left running locally. CHANGELOG not
updated under explicit protection; this dated report records the work. UI unchanged.

### Continued 8 October — repository/deployment alignment verified; Gate2 resumed

Starting fetched `origin/main` = local HEAD = **`dbd9f49184a93d18347fd42b4fb16d0f24b25131`**,
branch `main`. Both protected hashes match; only those two user edits are dirty.
`git diff --name-status 99c1ce0..dbd9f49` lists only this UAT report. **The repository/
Delivered staging SHA difference is solely report/checkpoint changes; staging is missing
no application code.** No redeployment required for this difference.
At08:11:31Z Delivered build `uat-1008043726-99c1ce0` remains READY, rollout SUCCEEDED,
current100%, not reconciling; public build-info confirms99c1ce0. CPU fixture read confirms
the owned19 October correction remains planned/unsigned, historicalv1 revoked and
Delivered head revoked. Usage entry99% five-hour /40% weekly remaining. Production is
outside all commands/scopes; no production operation/configuration change performed.
Resume corrected dual signatures, replacement release and exact older event replay;
do not repeat G&G or the already-passed revoked-PDF fix gate wholesale.

### Gate2 corrected replacement release and stale replay — PASS

Normal owned19 October UI reload confirms1/1 checked, GLUTEN/MILK CONTAINS and TREE_NUTS
MAY_CONTAIN. Recorded the two replacement signatures through normal pads with clearly
marked staging names `FIKA UAT PRODUCTION CHEF V2`/`FIKA UAT HEAD CHEF V2`. Existing
governed pending-OPLOC retry materializes **releasev2**, while source Menu publication
and canonical Production remainv1. The only current CPU release is:
`cpu-allergen-release:2026-10-19:menu-publication:rolling-week:2026-10-19:v1:day:0:v2`,
current/ready. Exactly2 distinct role signatures,1 revoked historicalv1, no duplicate
current release/signature. Delivered head is publishedv2.

Read the current GCS daily-bundle manifest/object through raw compressed-byte transport;
the canonical decoder verifies its compressed SHA256 and envelope. PackageVersion2 is
bound to that exact release and unchanged current Menu source hash; packet contains
GLUTEN/MILK and MAY_CONTAIN TREE_NUTS, with2 signatures. New signed PDF identity differs
fromv1. Original matrix/signature evidence is unchanged in revokedv1 history; its
immutable packet object remains readable. No history/blob rewrite or deletion.

Read exact original published/revokedv1 payloads from the existing CPU durable outbox,
then replayed unchanged bodies through authenticated staging `/api/internal/cpu-release-event`.
Used the documented direct callback's default source eventId identity, rather than resetting
the original delivered outbox receipt; this exercises older-release ordering. Both HTTP200
**superseded**. Original event IDs:
`cpu-allergen-release:cpu-allergen-release:2026-10-19:menu-publication:rolling-week:2026-10-19:v1:day:0:v1:published`
and the same prefix ending`:revoked`. No event fabrication, dead letter or auth bypass.
Current CPU plan and Delivered release head canonical-sorted snapshots are identical
before/after replay. GLUTEN remains CONTAINS; old clear/PDF cannot become current.

Normal reload of CPU and Delivered retains correct currentv2 authority. CPU matrix is
locked with corrected values and both scoped signatures; Delivered retains Published
Menuv1/1dish/2portions and exactly1 signed-PDF link to the new Drive identity. Its old
PDF is not exposed. Source canonical identity and immutable publication unchanged.
Focused CPU signing/source-lineage/schema checks **28/28 PASS**, zero skips, explicit
memory test store; prior Delivered134/134, CPU affected19/19, typecheck/build remain
applicable (no application source change in this continuation). Existing expected-lineage
checks and receipt monotonicity retained; no weakened concurrency protection.

**Gate2 PASS** for owned check→dual-sign→materialize→reopen/revoke→correct/re-check→
dual re-sign→new release→consumer→older published/revoked replay→reload chain.
Evidence `oct08-allergen-replacement-first-signature.json`, `replacement-both-signed.json`,
`replacement-current.json`, `after-old-release-replay.json`, `events-read.json`,
`events-replay.json`, `packet-proof.json`, `replay-stability.json` (all under `artifacts/uat`,
prefix `oct08-allergen-`); `oct08-resume-signing-lineage.log`; CUA UI snapshots/screenshots.
No redeployment required; Delivered99c1ce0/CPUe4dddbe verified, production untouched.
Next **Gate3 Logistics desktop timeline**. Retain this current owned19 October source for
queue/assignment testing, then retire it by normal withdrawal once those checks finish;
its expected canonical/Fulfilment/Logistics work is tracked UAT data, not an orphan.

## Hub stale-source guard and owned rapid-amend/withdraw gate — 7 October 2026

Starting fetched HEAD/origin/main: `e2adb67b75a98667cddab74edeefba8d0a2c84d5`.
Both protected hashes match the task instructions; CHANGELOG remains untouched
under explicit protection. This dated entry records the task instead.
Hub prior staging: `3446d5d9b58a5bd363e5655ec74a460bc3ce565d`,
`uat-1007132239-3446d5d`, verified READY/current/100%.
Pre-deploy diff contains only the three-line lower-sourceVersion guard and its
28-line regression in Hub; shared/runtime/dependency source has no additional diff.
Initial provider/consumer/auth/replay tests 28/28 PASS; Menu adapter/claim/withdrawal
tests 5/5 PASS; Hub typecheck and webpack build PASS; diff check PASS.
Full Hub baseline suite not rerun or claimed green; existing RC failures remain.
Exact validated `e2adb67` Hub-only rollout submitted: `uat-1007191808-e2adb67`;
build operation `operation-1791397086853-65d4423037ab9-e2f85af1-61027ca2`,
rollout operation `operation-1791397087112-65d4423076d3f-59695739-8d53c9bb`.

**New directly relevant P1 reproduced before live withdrawal:** Menu withdrawal
retains the published day content version. The lower-version guard alone lets an
earlier publication with the same version overwrite cancellation. Isolated real
Firestore regression FAIL before fix (`hub-guard-same-version-before.log`). No live
resurrection or direct Firestore write performed. Minimal Hub fix makes cancellation
terminal for the same Menu content version while permitting newer republish;
contracts/identity/history/auth and other source-domain behavior are unchanged.
Final focused provider/Fulfilment/auth/concurrent replay suite 30/30 PASS, including
same-version published/amended/withdrawn replay and valid newer republish. Expected
read/write shape unchanged: one known canonical document in the existing transaction;
rejected replay returns existing state without new domain/audit/requirement writes.
No new scheduler, polling or broad reads. Final build/deployment/live evidence follows.

Owned baseline: `rolling-week:2026-10-12`, Monday Haleon quantity 13, publication v2.
Exactly one canonical Production, one Fulfilment and one Logistics record, each
sourceVersion/version 2 and audit count 2. Existing immutable v2 event will be
replayed verbatim through authenticated `/api/production/materialise`: Menu's
governed retry skips delivered events, so its no-op cannot prove the Hub guard.
No delivery history reset, artificial dead letter or publication payload rewrite.
Evidence is ignored under `artifacts/uat/hub-guard-*`. Production untouched.

### Live progress and second directly relevant Hub defect

Initial `e2adb67` rollout READY/current/100% at 18:24:34Z. Same-version cancellation
fix pushed as `e6826baaeeb4b71e678cfad756f50b73a88fe89e`, deployed Hub only,
`uat-1007192502-e6826ba`, READY/SUCCEEDED/current/100% at 18:30:04Z.
Build operation `operation-1791397502777-65d443bcdf92b-c37736ad-368dcb31`;
rollout operation `operation-1791397503031-65d443bd1d7fc-900fb17f-77f80b49`.
Normal UI amendment 13→14 produced v3 at 18:25:42.324Z; second 14→15 produced v4
at 18:26:50.944Z. Publish HTTP 200 latencies 2.177217s and 2.381263s. Production
events delivered automatically at 18:26:09.070Z and 18:27:05.970Z respectively.
Exactly one Production/Fulfilment/Logistics record at v4/quantity15/audit count4.
Exact v2 replay returned duplicate=true, created=false, current sourceVersion4,
canonical version4, quantity15, audit4, CPU/Logistics handoff delivered.
All three bounded canonical/downstream JSON snapshots were byte-for-byte unchanged.
Menu reload retained clean published v4/delivered; CPU showed one Haleon dish x15;
Delivered-In showed Menu v4/15 portions, awaiting separate CPU allergen sign-off.

Normal whole-week withdrawal on `e6826ba` returned HTTP200 in **2.361519s**, request
18:30:32.124200Z; all six durable events occurred 18:30:34.421Z. UI showed
Withdrawn/pending; browser reload did not remove the obligation. Production became
cancelled canonical version5/sourceVersion4, audit5; Fulfilment/Logistics became
withdrawn version/sourceVersion5, audit5. Logistics owned queue/load/movement counts0.

**Second proven directly relevant P1:** Hub's CPU notification key used Menu content
version, which is unchanged on withdrawal. CPU reuses the earlier amendment receipt
and fails its monotonic same-sequence/different-content projection check. The owned
withdrawal materialisation event persisted failed/retryable with CPU handoff pending;
CPU projection still v4/menu_available. No failure manufactured or terminal reset.
Minimal Hub route fix derives notification identity from accepted canonical order ID
and revision, and changeType from the accepted order state, so stale replay forwards
current cancellation rather than the obsolete input action. DTO/auth unchanged;
no CPU/Menu source edit or deployment. Provider/consumer/adapter tests **33/33 PASS**.
CPU projection/durable consumer tests **23/23 PASS** with explicit
`FIKA_CPU_PLAN_STORE=memory`, `NODE_ENV=test`. Initial additional run selected
Firestore while six fixtures asserted the memory-only test store (17 pass/6 fail);
this harness configuration failure is retained in evidence, not reported green.
Automatic review rejected the premature commit/push; corrected documented test
store selection passed before retrying. Hub typecheck/webpack build/diff check PASS.
Final rollout and automatic recovery evidence follows; do not call this interim gate
PASS while CPU remains stale.

### Final live evidence and disposition — full gate FAIL

Final implementation/pushed main SHA: **`c0a41ae3fe60393d20fc810fa6f0c1dacbe48b0f`**.
Final Hub-only rollout **`uat-1007193534-c0a41ae`**, verified READY/SUCCEEDED,
not reconciling/current/100% at **18:39:59Z**. Build operation
`operation-1791398134589-65d446176a8b8-ab868593-a5f96e22`; rollout operation
`operation-1791398135169-65d44617f8283-b5f33b42-ba0b8841`.
Final provenance reconfirmed: Menu `06181e4`, CPU `9aa2cba`, Delivered-In `71b2860`,
Logistics `ec1b110` unchanged, all READY/current/100%. Production untouched.
Final report-only commit follows this implementation and is identified in the
closing return; it changes neither code nor deployment source.

Exact owned production events used (publication `menu-publication:rolling-week:2026-10-12`):

| Purpose | Exact immutable event ID |
| --- | --- |
| Older replay (quantity13) | `production.materialise:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:0:amended:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:v2` |
| First amendment (quantity14) | `production.materialise:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v3:day:0:amended:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:v3` |
| Newest amendment / same-version replay (quantity15) | `production.materialise:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:0:amended:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:v4` |
| Withdrawal | `production.materialise:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:0:withdrawn:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:v4` |

The other five withdrawal event IDs are
`menu.day.withdrawn:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:0:withdrawn:v4`,
`menu.day.withdrawn:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:1:withdrawn:v1`,
`menu.day.withdrawn:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:2:withdrawn:v1`,
`menu.day.withdrawn:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:3:withdrawn:v1`,
`menu.day.withdrawn:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v4:day:4:withdrawn:v1`.
They settled at 18:31:17.345 / 19.023 / 19.117 / 19.231 / 19.316Z respectively.
Production withdrawal settled **automatically at 18:40:06.276Z**, after nine real
retry failures while the CPU notification fix was built/deployed. No manual reset,
artificial failure, event rewrite or direct operational Firestore mutation.
All **30 owned events delivered**, zero pending/failed/dead-letter at final read.
Menu reload retains **Withdrawn · downstream handoff delivered**. Root authoritative
publication remains withdrawn, all five current days withdrawn, no compiled/current
packet pointers. Immutable snapshots v1-v4 still exist with identical SHA256 values
before/after final replays (`hub-guard-history-integrity.json`). Audit has exactly
one initial publication, three amendments and one week withdrawal.

Canonical stable identities are exactly those in the Menu latency acceptance above:
Production `production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`;
Fulfilment `fulfilment-requirement:cpu-production:production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`;
Logistics `logistics-job:fulfilment-requirement:cpu-production:production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`.

| State / boundary | Canonical revision | Source version | Quantity retained | State | Audit count | Count |
| --- | --- | --- | --- | --- | --- | --- |
| Before amendment | 2 | 2 | 13 | menu_available | 2 | 1 |
| Newest amendment and after v2 replay | 4 | 4 | 15 | menu_available | 4 | 1 |
| Withdrawn Production, before/after v2 and v4 replays | 5 | 4 | 15 (history; inactive) | cancelled | 5 | 1 |
| Withdrawn Fulfilment, before/after both replays | 5 | 5 | 15 (history; inactive) | withdrawn | 5 | 1 |
| Withdrawn Logistics, before/after both replays | 5 | 5 | 15 (history; inactive) | sourceStatus withdrawn | 5 | 1 |

Post-withdrawal exact v2 and original v4 amendment replay: HTTP200, duplicate=true,
created=false, current cancelled order revision5/sourceVersion4 returned. Production,
Fulfilment and Logistics snapshots byte-for-byte unchanged; no duplicate or resurrection.
Bounded direct projections after both replays: CPU owned orders0, Logistics owned
planning queue0/load0/movement0. Hard-refreshed CPU owned week shows no bookings;
Logistics Monday queue0, separate pre-existing three native loads retained and untouched.
This is an owned-scope assertion, not a claim of empty global operational data.
Replay responses report Logistics delivered but **CPU pending**. CPU request logs
show four HTTP409 responses at 18:40:56–18:41:00. Current CPU cancellation and all
owned Menu event delivery remain intact; repeated CPU notification/rebuild idempotency
is **not** declared PASS and requires bounded diagnosis. Error log query contained
no structured error detail; exact post-fix 409 cause remains unconfirmed.

**New confirmed P1 / full withdrawal gate FAIL:** Delivered-In hard reload of the
owned Monday removes Monday and redirects to Tuesday13; Tuesday–Friday remain
navigable and observed Tuesday is Published blank, despite all five authoritative current days being
withdrawn. Observed Tuesday shows Published Menu v1 / Published — No service rather
than withdrawn. No owned dish/production work resurrected, but operational freshness
and withdrawal semantics are wrong. Inspected deployed source matches main for this
path: `apps/delivered-in/lib/menu-planning-week-packet.ts` reads publication packets,
then falls back to historical snapshots when packets are absent, without excluding
an authoritatively withdrawn publication. Withdrawal intentionally clears current
packets, so historical blank snapshots can appear current. This must be corrected
without deleting historical evidence or treating integrity corruption as rebuildable.
Delivered-In was inspected read-only, not edited or deployed in this task.

**Exact next gate:** remediate and validate Delivered-In authoritative withdrawn-week
tombstone/fallback and withdrawn-day navigation/cache behavior; diagnose repeat CPU
notification HTTP409; deploy only the affected validated staging app(s), then rerun
the existing owned withdrawn-week consumer and exact stale replay checks. Do not
republish the owned week merely to hide the failure. After these new withdrawal
gates pass, resume the existing Grab & Go durable handoff deployment/live chain.
Existing Hub/Delivered baseline failures and other RC gates remain separate and open.
No whole-suite-green, six-app RC, signed allergen acceptance or launch PASS asserted.

Validation totals: Hub affected provider/Fulfilment/auth/adapter/concurrent replay
33/33 PASS; CPU projection/durable consumer23/23 PASS; Menu adapter/recovery5/5 PASS;
Hub typecheck and webpack build PASS after each code fix; diff check PASS. No full
Hub suite rerun. Protected files unchanged and excluded from every commit. Style
Guide compliance PASS for inspected existing UI; no UI implementation edited.
Final screenshots and exact safe JSON/logs retained under `artifacts/uat/hub-guard-*`.
Final source-control/protected integrity checks and report-only push follow.

## Withdrawal consumer P1 remediation — 7 October 2026

Starting fetched HEAD/origin/main **`e54fd92a55268e5a6b8844844f741e499dd15310`**.
Protected SHA256 values verified unchanged; no clones/worktrees/subagents.
User usage guard: no new architectural remediation below 12%; checkpoint current
atomic work if threshold is reached before both fixes are locally validated.
Initial five-hour remaining26%, weekly58%; latest local validation remaining17%.

Delivered-In owns its operational projection and navigation. Withdrawn Menu
publication heads now return an explicit tombstone before any historical fallback;
known active heads use their packet/current snapshot pointer, not a scan of history.
Only pre-head records use bounded legacy compatibility. Authority query failure
returns unavailable, never historical published bytes. Corrupt active/current or
explicit historical packets retain integrity errors. Immutable v1-v4 snapshots are
not deleted or rewritten. Requested-week head/recovery checks the bounded Menu
authority even when a cached derived week exists; withdrawal reconciles only the
five scoped weekdays missing a withdrawn index marker. Repeated withdrawn loads
do not rewrite already withdrawn markers. Cache hydration carries withdrawn dates,
evicts withdrawn packages and displays a distinct withdrawn-week message. No polling.
Cold/warm: one bounded publication-head query (limit16), active missing packet uses
one known current snapshot read; withdrawn state reads no historical snapshots.
First legacy stale-index recovery marks at most five existing scoped projections;
steady state reads the index and writes none. AUTHMOD/OPLOC scope remains enforced.

Exact CPU diagnosis from accepted owned cancellation revision5: live HTTP409 body
**`CPU_PACKAGE_SEQUENCE_CONFLICT` / CPU package sequence664 has conflicting content**.
Receipt/projection cancellation remains valid; package publisher incorrectly compares
new compressed bytes containing regenerated timestamp/revision metadata with existing
immutable bytes for the same semantic source. Hosted regression reproduces different
encoded hashes for identical operational source. Fix compares the existing semantic
sourceHash and sequence, verifies the saved compressed bytes and their decoded semantic
hash, then reuses the existing manifest. Different semantic content at same sequence
still409; corrupt/missing stored bytes fail closed, no blind success conversion.
No receipt/audit/sequence/head/object increment on exact package replay; newer source
and older-source supersession retain the existing governed path. No Hub/contract edit.

Local validation: Delivered-In focused withdrawal/packet/index21/21 PASS. CPU full
suite **291/291 PASS**, zero skips. Delivered-In full suite **130 tests,129 PASS,1 FAIL**,
zero skips: existing `corrupt Grab & Go SQLite recovers from the preserved JSON source
without returning an empty list` raises `Grab & Go operational persistence is unavailable`,
cause `file is not a database` / `ERR_SQLITE_ERROR`26. This exact unchanged test/store
failure was independently recorded before this task; it has no preserved JSON fixture.
Classification: existing local SQLite recovery fixture/coverage gate, not a regression
from these hosted withdrawal changes, not waived or counted green. Four known packet
fixture failures now pin asOf to their September operational date; an obsolete read-shape
assertion was updated to the new authority barrier, behavior covered by the reader test.
Both app typechecks and webpack production builds PASS; diff check PASS.
Initial focused CPU run found the old test expecting packageVersion increment on repeat;
updated it to require unchanged packageVersion. Initial Delivered build caught test fixture
and Dashboard types; corrected and rerun successfully. Generated CPU root-params import
was removed from task diff; no runtime dependency change.
Style Guide compliance PASS: existing light semantic text, distinct withdrawn label,
no new visual primitives or polling. Logs under `artifacts/uat/consumer-p1-*`.
Both P1 fixes locally validated before the12% threshold. Exact commit/deployment/live
retest evidence follows. Production untouched; CHANGELOG remains explicitly protected.

### Consumer P1 staging/live acceptance and usage checkpoint — PASS

Implementation pushed/deployed **`e4dddbe0164ce295a447eea7803ebea278e6e8ca`**.
Only Delivered-In and CPU were deployed; Hub stays `c0a41ae`, Menu stays `06181e4`,
Logistics stays `ec1b110`. Production untouched.

| Staging backend | Build/rollout | Exact SHA | Verified |
| --- | --- | --- | --- |
| `fika-delivered-in-staging` | `uat-1007200422-e4dddbe` | `e4dddbe0164ce295a447eea7803ebea278e6e8ca` | READY/SUCCEEDED/current100%, not reconciling,19:08:21Z |
| `fika-cpu-production-staging` | `uat-1007200425-e4dddbe` | `e4dddbe0164ce295a447eea7803ebea278e6e8ca` | READY/SUCCEEDED/current100%, not reconciling,19:08:22Z |

Delivered build/rollout operations:
`operation-1791399863021-65d44c87c6f12-8abbef0a-ebe9dc70`,
`operation-1791399863269-65d44c8803a5e-d02d485e-8697d2f5`.
CPU build/rollout operations:
`operation-1791399865399-65d44c8a0b91d-fbca9ca0-5773a156`,
`operation-1791399865539-65d44c8a2dc81-9edd1607-715e020e`.

Owned week **`rolling-week:2026-10-12` was not republished**. Normal Delivered-In
hard reload at Haleon now retains the exact Monday12 URL, shows **Menu withdrawn
for the selected operational week**, exposes no published service-day navigation,
and no longer falls through to historical Tuesday blank bytes. Second hard reload
preserves the withdrawn state and Monday URL. Historical v1-v4 snapshot SHA256 values
are identical before/after this retest. All five authoritative current days remain
withdrawn; root current packet/snapshot pointers remain absent.

Replayed the exact older immutable v2 event through governed authenticated Hub
`/api/production/materialise` (same exact event ID listed in previous gate).
HTTP200, duplicate=true, created=false, **CPU handoff delivered**, Logistics delivered.
Current order returned cancelled, canonical revision5/sourceVersion4, retained history
quantity15, audit5. One Production, one withdrawn Fulfilment and one withdrawn Logistics
record preserve the same stable IDs. Fulfilment/Logistics version/sourceVersion5/audit5.
No duplicate/resurrection. CPU owned orders0; Logistics owned queue/load/movement0.
All30 owned Menu events remain delivered, zero pending/failed/dead-letter.

Before/after direct reads of the accepted CPU cancellation receipt and day/week/review
package heads prove **all six normalized documents identical**. Receipt sequence664,
CPU day revision6, CPU week revision17, day/week/review packageVersion1 all unchanged;
same immutable object names, hashes and promotion timestamps. An initial raw JSON
comparison was false solely because Firestore returned field keys in different order;
canonical sorted-key comparison proves unchanged content. No source/audit/receipt/head
sequence increase, no manual outbox reset, cloud repair or historical mutation.
The initial direct diagnostic probe omitted changedAt in its stored request because
the canonical order has createdAt but no updatedAt; it reused the existing accepted
receipt. Final proof is the real Hub adapter using its existing createdAt fallback,
not a fabricated successful CPU request or a generic conversion of409 into200.

**Menu withdrawal consumer P1 A and P1 B: PASS locally and on staging.** Full launch
remains open: Delivered SQLite baseline129/130 is explicitly unresolved; other previous
RC gates, signed allergen acceptance, historical recovery and aligned six-app regression
remain open. No full Delivered green or P0/P1-zero assertion.

Usage reached **11% five-hour remaining** after both P1s had been fixed and locally
validated at17%. Completed the current staging/live atomic verification and saved a
clean checkpoint. No new architectural remediation or Grab & Go live mutation begun
below12%. No background local test process remains; staging jobs retain existing scope.
**Exact next gate:** Grab & Go durable handoff scheduler configuration/accepted bounded
invocation, then one owned non-Xchange submit→Production→CPU→Fulfilment→Logistics→amend→
cancel→reload/exact replay. Delivered-In already serves the durable G&G implementation
within `e4dddbe`; do not redeploy an old SHA or repeat passed Menu/Hub work. Verify usage
and current exact source before starting that next journey. Preserve Xchange exclusion
and the withdrawn Menu week; no new accounts/grants or production changes.

CHANGELOG unchanged by explicit protection; dated report is task evidence. Both protected
hashes still match. Report-only final commit follows the implementation and is returned
in the closing message. Evidence: `artifacts/uat/consumer-p1-*`, plus the final bounded
owned snapshot under `hub-guard-consumer-final-*`. Style Guide compliance PASS.

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
| 6 Logistics desktop | PARTIAL LIVE PASS / GATE PENDING | `ec1b110` | Governed picker, server labels, ordinary historical labels and single-click/keyboard Details PASS; Van 2 native movement clear, two-tab stale edit denial, reload and reschedule PASS | Merged canonical-load clear/reconciliation, drag/move/resize/23:45/invalid-window and separate-context concurrency remain pending |
| 7 Grab & Go / Xchange | CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING | `ceaff01` committed/pushed; not deployed | Atomic hosted source + immutable delivery obligation; historical recovery, scoped retry, lease/backoff and monotonic Hub replay regressions PASS | Non-Xchange submit/amend/cancel/full downstream live chain and new Delivered recovery Scheduler pending; intentional Xchange exclusion retained |
| 8 Owned amendment | HOSPITALITY LIVE PASS / EXACT REPLAY PENDING | Hub `1dd58ce` READY/current 100% | Old order amended v2; old requirement/job withdrawn v2; one replacement r12/39-piece queue item; all known outbox events delivered; reload retained state | Exact-event live replay pending; separate historical booking remains untouched |
| 9 Owned cancellation / withdrawal | HOSPITALITY LIVE PASS / MENU GATE PENDING | Hub `1dd58ce` READY/current 100% | Cancelled booking v14 and replacement order v2; replacement requirement/job withdrawn v2; projection revision 205/sequence 203 has zero owned queue/load items; reload does not resurrect work | Menu withdrawal/republish and exact-event live replay pending |
| 10 Date / cache / retry | NARROW DATE LOCAL/LIVE PASS / FULL GATE PENDING | CPU/Logistics `9aa2cba` | Both fixed van non-today service-date reloads retain permitted run; opposite-vehicle request revalidated; CPU Today/allergen default correct; BST/GMT/DST local boundary tests PASS | Broader cache/retry/concurrency live gates unexecuted |
| Driver execution | VAN 1 AND VAN 2 LIVE LIFECYCLE / RELOAD PASS; FULL GATE PENDING | Van 1 `0fe3ec6`/`9aa2cba`; Van 2 `ec1b110` | Shared authorised session, fixed phone views, scoped stops, loading/dispatch/completion/return/reload PASS; Van 1 v10 and Van 2 v9 complete | Final shared AUTHMOD identity preparation, merged-load gates and separate-context concurrency remain; no individual accounts/grants created |
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
- P0 Hospitality: bounded 13 October state shows superseded/amended orders retaining pending fulfilment and Logistics work. Missing durable event staging was fixed, validated and deployed at `1dd58ce`; owned live amendment/cancellation PASS; historical recovery and exact-event replay remain pending. No direct operational repair performed; pre-existing retired records have not been repaired.
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

Historical finding at `0fe3ec6` (FIXED / LOCAL AND LIVE PASS at `9aa2cba`): reload reset the service date to today (7 October) while the URL retains the 12 October run ID. It then shows NO WORK until 12 October is reselected. Durable execution state persists, but selected-date persistence fails. This is a confirmed **P1**, so the full driver launch gate remains open. No new remediation begun in closure mode.

Exact owned records for safe continuation:

- Menu week: `rolling-week:2026-10-12`; publication `menu-publication:rolling-week:2026-10-12`, v1; Monday publication day `menu-publication:rolling-week:2026-10-12:v1:day:0`.
- Menu canonical CPU order: `production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`; Firestore document hash `d97f18434e5bd5b165df40d48fdde04e98c047866f003b9cfdb5133ef97ee25b`.
- Allergen release: `cpu-allergen-release:2026-10-12:menu-publication:rolling-week:2026-10-12:v1:day:0:v1`; the corresponding materialisation delivery ID is `cpu-allergen-materialize:cpu-allergen-release:2026-10-12:menu-publication:rolling-week:2026-10-12:v1:day:0:v1:oploc:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:order:production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`.
- Hospitality owned booking: `booking:mnk:2fdaea9b9ddbddf136163f3a5a11cd76`; portal `MNK-20261006122750-BFD2`, Completed, 13 October 12:00. Use this clearly marked UAT record for the governed reopen/amend/cancel workflow. Do not silently edit the separate original booking `booking:mnk:86ee28f023384fde1245816b9b595244`.
- Logistics owned run: `run:2026-10-12:van-1` (completed v10). Van 2 run `run:2026-10-12:van-2` is now completed v9; see latest live checkpoint.
- Owned delivery movement: `movement:1791359068176` — FIKA-AUTOUAT-20261007 Driver delivery.
- Owned collection movement: `movement:1791359274129` — FIKA-AUTOUAT-20261007 Driver collection.
- Delivery stop: `stop:run:2026-10-12:van-1:movement%3Amovement%253A1791359068176%3Aendpoint:1791359236769` (completed v5).
- Collection stop: `stop:run:2026-10-12:van-1:movement%3Amovement%253A1791359274129%3Aendpoint:1791359309324` (completed v3).

Evidence screenshots (ignored local artifacts, not repository source): `artifacts/uat/shared-session-run-completed-0fe3ec6.png`, `artifacts/uat/cpu-quantity-card-d916c8d.png`, `artifacts/uat/cpu-quantity-detail-d916c8d.png`, `artifacts/uat/owned-allergen-release-current.png`, `artifacts/uat/owned-week-published.png`. Corresponding test/build logs are under `artifacts/uat/autolaunch-*`.

### Remaining P0 / P1 and unexecuted work

- **P0 historical downstream retirement unresolved:** owned Hospitality live amendment/cancellation now PASS at Hub `1dd58ce`; pre-existing retired requirements/jobs for the separate historical booking remain unmodified. They require a separately justified governed recovery path; do not erase evidence or directly repair operational state.
- **P1 mobile service-date reload:** FIXED / LOCAL AND NARROW LIVE PASS at `9aa2cba`; both fixed van routes retain 12 October and their own run after reload.
- **P1 confirmed UI omission:** New movement shows “Integration Hub locations are unavailable” and an empty governed-site selector while the day health indicates OPLOC availability. Source inspection shows `projectionToDashboardData` deliberately returns `oplocs: []`, so the form lacks a reference catalogue. One-off request-scoped destinations were used for the owned execution UAT. No fake permanent OPLOC created. FIXED / LOCAL AND LIVE PASS at `898b0c9`; final labels and Details live PASS at `ec1b110`.
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

## 2026-10-07 — Remove synchronous Menu publication handoff P1

Authoritative task baseline: `ca5b1039676844d07ff239ef3c30a688ad1f22ea`.
Fetched origin and fast-forwarded `main` (already current). Before diagnosis,
Menu staging build `build-2026-10-07-001` was verified READY, current/100%, with
that exact source SHA. This task supersedes the older checkpoint's next-task
sequence only for the publication-latency remediation requested by Derek.

Publish/amend and day/week withdrawal now return after authoritative publication
and durable outbox commit, reporting success with handoff pending. No normal
mutation invokes downstream replay. The unchanged event IDs, atomic history,
leases, predecessors, retries/backoff and ten-attempt dead-letter boundary remain
in force. Targeted Integration Administrator retry remains available; its response
now reads actual durable state, including repeated already-delivered retries.

There was no hosted Menu recovery endpoint or Menu Scheduler. Added
`POST /api/internal/menu-publication-outbox`, with exact middleware service-route
exemption, timing-safe existing internal-token check and integer limit 1–25.
It wraps the existing global bounded claim/replay primitive; it never resets dead
letters. The staging config already references `FIKA_INTERNAL_API_TOKEN@3`.
Provisioning and live results will be appended after validated deployment.

Portion Planner persistently shows pending/delivered/intervention-required and
offers Refresh handoff status. Status revalidates independently of the menu-week
cache on load/version change and explicit refresh. No new timer/polling, no
Firestore read-amplification refactor, no shared contract/provider changes.
Existing light surfaces, semantic text, shared button/focus styling and accessible
status announcement are reused. Style Guide compliance: PASS.

Local validation: focused publication/API/outbox suite **110/110 PASS**; full Menu
Planning suite **219/219 PASS**, zero skips; typecheck PASS; webpack build PASS;
shared durable-outbox tests **2/2 PASS**; Hub production/provider tests **14/14
PASS** on an isolated loopback Firestore emulator. Provider coverage includes
stable materialisation identity, duplicate delivery, publication lineage and late
Menu replay after newer withdrawal. New isolated API regressions prove no inline
consumer, durable pending response, reopen/recovery after response, concurrent
claims, bounded authenticated worker calling the real adapter, repeated delivery,
backoff, dead-letter, deliberate reset and durable week withdrawal. Existing
clean/dirty/amendment/order-determinism regressions remain green.

Runner corrections: restricted Windows `tsx` initially failed before tests with
`uv_os_get_passwd ENOMEM`; executed successfully with authorized escalation.
Initial new fixture was blank/incomplete and was corrected to a fully isolated
populated reference fixture. First provider run used an unapproved demo project
name and was rejected fail-closed; rerun used allowed `demo-fika-os` at isolated
port 8096 and passed. These failed attempts are not called green.

Protected CHANGELOG/MenuData hashes verified unchanged before edits and validation;
neither staged nor modified. CHANGELOG updated: **no — explicit task protection**.
This dated UAT entry records the task. Production untouched. Implementation SHA,
push, staging rollout, Scheduler and exact owned-week live evidence pending the
deployment phase below.

### Hosted recovery defect discovered and corrected

Implementation `bca19c4b4e48b90dcc24a2a6ed06094aebba2687` was pushed and deployed
to Menu staging, rollout `uat-1007180636-bca19c4`, verified READY/SUCCEEDED/current
100% at 17:10:32Z. The staging-only recovery job was created ENABLED with existing
token version 3 and limit 25. Its initial worker smoke returned 503; no live
publication mutation was begun while recovery was unavailable.

Both existing modern and compatibility Menu outbox indexes were READY. Reproducing
the actual adapter on the isolated emulator confirmed an existing cursor bug:
empty/last-page global claims wrote `legacy`/`modern` with JavaScript undefined,
which strict Firestore rejects. Mock queue tests had accepted these invalid values.
The minimal correction omits absent cursor properties while retaining the same
eligibility queries, pagination, leases and delivery logic. Strict cursor contract
coverage failed before the fix; actual Firestore empty-queue recovery passes after
it. Worker infrastructure failures now emit structured server diagnostics.

Also executed an additional isolated provider test: source v1 → amendment v2 →
amendment v3, followed by concurrent v2/v2/v3/v1 replays. All return duplicate and
the single canonical order remains at source v3, quantity 3 and three audit entries.
No production or staging business data used for this test. Final validation and
replacement Menu-only rollout are recorded below.

Final correction validation: focused publication/API/Firestore/clean-dirty tests
**99/99 PASS**, full Menu suite **220/220 PASS** (zero skips), typecheck PASS,
webpack build PASS, actual strict Firestore cursor probe PASS, diff check PASS.
One intermediate full run completed all test assertions but its temporary-directory
cleanup encountered Windows EPERM; bounded cleanup retries were added and the full
run then completed green. No operational storage/query refactor or index change.

### Final deployment and live acceptance — Menu latency P1 PASS

Final deployed implementation SHA: **`06181e4b50262fb505396fbc5080ad9907b6bcce`**.
Both implementation commits (`bca19c4`, `06181e4`) were pushed to canonical `main`.
Final Menu-only build/rollout: **`uat-1007182022-06181e4`**, build operation
`operation-1791393621324-65d435473b3e5-b0ab1132-59a5b576`, rollout operation
`operation-1791393621614-65d4354781e42-5e55afda-c717c5e9`. App Hosting API verified
READY / SUCCEEDED / not reconciling / current 100% at **17:23:48Z (18:23 UK)**.
Evidence: `artifacts/uat/menu-async-final-rollout-progress.json`.

Scheduler `projects/fika-os-dev/locations/europe-west4/jobs/fika-menu-publication-outbox-recovery`
is ENABLED, every minute, Europe/London, POST to the friendly Menu staging URL,
body `{"limit":25}`, deadline 300 seconds, three transport retries, 30–300-second
backoff. Uses existing `FIKA_INTERNAL_API_TOKEN@3`; no new secret/IAM/account or
production configuration. Corrected authenticated smoke: HTTP 200; unauthenticated
smoke: HTTP 401. Automatic attempts at 17:25/26/27/28 returned HTTP 200. Worker
consumer failures remain in durable event state, never falsely marked delivered.
The initial smoke's per-event failure belonged to an older unrelated obligation.
Bounded read found historical August/September failures with Delivered-In
invalidation HTTP 500, including legacy attempt counts above ten; this is a
separate governed historical-recovery gate, not a reset/cleanup performed here.
No artificial failure was introduced to produce a dead letter.

Normal authorized UI amended the checkpoint-owned week **`rolling-week:2026-10-12`**:
`FIKA-AUTOUAT-20261007-ALPHA Salad`, Monday Haleon allocation **12 → 13 portions**.
Save made v1 dirty; **one** Publish week amendment produced clean v2. Publication
ID: **`menu-publication:rolling-week:2026-10-12`**; Monday publication day:
**`menu-publication:rolling-week:2026-10-12:v2:day:0`**.

Before: supplied live evidence ~48 seconds, ~47.7 seconds server-side with 22
downstream events. After: Cloud Run POST `/api/rolling-menu` **HTTP 200,
2.117935 seconds**, revision `fika-menu-planning-staging-uat-1007182022-06181e4`,
request timestamp 17:27:19.213647Z. This owned amendment queued six events; the
before/after journeys have different fan-out sizes. Source and API tests prove
normal response completion performs no downstream calls, rather than claiming a
controlled 22-event benchmark. Launch target <3 seconds: **PASS**.

UI persistently displayed **Published · downstream handoff pending** and
**Published v2 ✓**. Immediately refreshed the browser; at 17:28:01.377Z the
publication had six old delivered events plus **six new pending events**, no
failed/dead-letter events. This proves the browser refresh did not remove the
committed downstream obligation. Scheduler recovery subsequently delivered all
six new events without a manual owned-event replay. New event IDs and settlements:

| Exact event ID | Delivered UTC |
| --- | --- |
| `menu.day.amended:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:0:amended:v2` | 17:28:03.326Z |
| `production.materialise:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:0:amended:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:v2` | 17:28:06.013Z |
| `menu.day.amended:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:1:amended:v1` | 17:28:06.184Z |
| `menu.day.amended:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:2:amended:v1` | 17:28:06.339Z |
| `menu.day.amended:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:3:amended:v1` | 17:28:06.504Z |
| `menu.day.amended:menu-publication:rolling-week:2026-10-12:menu-publication:rolling-week:2026-10-12:v2:day:4:amended:v1` | 17:28:06.656Z |

All occurred at **17:27:21.059Z**. Production delivery settled after ~45 seconds;
the final new event after ~45.6 seconds. At 17:38:38.995Z all twelve historical+
new events remained delivered, zero pending/failed/dead letter. Manual Refresh
handoff status showed delivered; a further hard refresh retained v2, clean state,
13 portions and delivered status. No new aggressive polling was introduced.

Downstream evidence, bounded by known source/requirement IDs:

- One canonical Production Order:
  `production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`;
  document `d97f18434e5bd5b165df40d48fdde04e98c047866f003b9cfdb5133ef97ee25b`,
  version/sourceVersion 2, quantity 13, exactly two audit entries (create/amend).
  Repeated automatic recovery left the same version, quantity and audit count.
- CPU day projection `2026-10-12` revision 3, change sequence 631. Normal CPU UI
  showed exactly one Haleon job, the owned dish x13; Tuesday–Friday had no bookings.
- Delivered-In normal UI at governed Haleon
  `oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`, week/day 2026-10-12, showed Menu v2,
  one dish and 13 portions. Its separate CPU checker remains awaiting sign-off;
  this is not claimed as signed allergen release acceptance. No signature mutation.
- One Fulfilment Requirement, v2/sourceVersion 2, quantity 13:
  `fulfilment-requirement:cpu-production:production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`.
- One Logistics job for that exact `requirementId`, v2/sourceVersion 2, quantity 13:
  `logistics-job:fulfilment-requirement:cpu-production:production-order:v1:menu-planning:rolling-week:2026-10-12:day:1:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`;
  source status amended, production readiness attention, delivery pending.
  No dispatch or movement mutation. Initial query used absent `sourceEntityId`;
  corrected to the domain's actual stable requirement ID before counting jobs.

Safe evidence retained under ignored `artifacts/uat/menu-async-*`: rollout/API
metadata, scheduler configuration/invocations, HTTP timing, exact event snapshots,
canonical/Fulfilment/Logistics records and pending/delivered/CPU/Delivered-In PNGs.
Browser direct API navigation was blocked, so consumer verification used normal
authorized UI plus targeted read-only cloud evidence. No browser security barrier
was bypassed. Style Guide compliance **PASS**.

Acceptance A–F: local API/adapter/claim tests plus live pending → refresh → automatic
delivery and stable canonical state PASS. G/H: isolated retry/backoff/ten-attempt
dead-letter tests PASS; no destructive live failure manufactured. I: exact rapid
two-amendment/delayed-older concurrent provider test PASS **locally only**. J:
durable withdrawal and downstream cancellation tests PASS locally; this live task
performed one amendment, not a new withdrawal journey. K: governed targeted retry
and repeated delivered retry tests PASS. L: clean/dirty/amendment/hard-refresh
regressions PASS locally and on the owned live journey.

**Exact next gate:** deploy the already validated Hub stale-source guard to staging
under a separately authorized Hub rollout, prove READY/current/100%, then run the
rapid-amendment/stale-replay and withdrawal convergence gate. Hub currently serves
`3446d5d9b58a5bd363e5655ec74a460bc3ce565d`, whose source lacks the guard added by
`ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe`. Current CPU is `9aa2cba`, Delivered-In
`71b2860`, Logistics `ec1b110` (all READY/current/100%). No other app was deployed
in this Menu-only task. Do not equate local guard tests with proof on that older
Hub rollout. Existing historical handoff failures and the other launch gates above
remain open; no six-app aligned RC, P0/P1-zero or whole-launch PASS is asserted.

**Result: Menu synchronous-publication latency P1 PASS; whole-launch gate remains
open.** Protected files remain unchanged and excluded from commits. CHANGELOG
updated: no, explicit protection; this dated report is the task record. Production
untouched. Final report-only commit follows this validated implementation and is
identified in the closing response; it does not change the deployed source SHA.

Final read-only verification at 17:54:39Z: Menu remains READY/current/100% at exact
`06181e4b50262fb505396fbc5080ad9907b6bcce`; Scheduler remains ENABLED with limit 25
and internal header configured. Isolated emulator on port 8096 stopped after
validation. Protected SHA256 values still exactly match the authoritative prompt.

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

## Resume checkpoint — 7 October, superseding prior pending rows

This section supersedes historical status statements above. No RC is frozen; no
production configuration/deployment occurred. Current fetched `origin/main` before
the hosted handoff commit: `ec1b11029beb5c03e7e68cb54c1ca55cc6fbac85`.
Resume started at `d1c9e5d7cbb540def2b4882d69635315e60ea398`.

Additional pushed commits today, after the original five listed above:

- `d1c9e5d7cbb540def2b4882d69635315e60ea398` — prior report checkpoint.
- `9aa2cba7d901fd1a69f97d465852758a560abd49` — fixed mobile reload and CPU London dates.
- `898b0c9da2e2233bfea185f2858e35f78879c2ee` — governed movement location picker.
- `3446d5d9b58a5bd363e5655ec74a460bc3ce565d` — exact Hub dead-letter recovery.
- `d107e6066918aa1e16d0930f9bc03af23863459f` — server movement labels and legacy reconciliation.
- `ec1b11029beb5c03e7e68cb54c1ca55cc6fbac85` — Details/keyboard interaction and ordinary legacy labels.

### Completed Logistics live gates

At `ec1b110`, build `uat-1007134501-ec1b110`, READY/current/100%, the existing
authorised session executed Van 2 on 12 October through the normal fixed mobile
view. Owned movement `movement:1791375509831`, title
`FIKA-AUTOUAT-20261007-VAN2 governed delivery`, is one unit for Haleon
`oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b`, 14:00–14:30.
Normal return-to-planning removed its stop. A second tab's stale timing edit was
rejected with “We could not find that Logistics record. Refresh and try again.”
(404; not misreported as 409). Both tabs reloaded with no resurrected Van 2 stop.
The same movement was rescheduled once normally; no replacement movement created.
This is a native movement smoke, not the still-pending merged canonical-load gate.

Shared mobile session → correct Van 2 run → one assigned stop → loaded → Dispatch
vehicle → arrived → completed delivery → confirmed returned to CPU → reload PASS.
Run `run:2026-10-12:van-2` is completed v9, returned
`2026-10-07T12:56:12.979Z`. Stop
`stop:run:2026-10-12:van-2:oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b:1791377457074`
is completed v5; loaded v3, arrived v4, completed v5. Reload retains 12 October,
Van 2 and 1/1 completed with zero attention. Van 1 fixed view has no owned Van 2
movement, and Van 2 showed no Van 1 stops. Source movement remains planned v4;
execution authority is the completed stop/run, and these distinct states are not
misreported. Current account is UAT authority, not a confirmed permanent shared identity.

Historical movement labels and normal Details click now live PASS. Evidence:
`movement-label-details-live-ec1b110.png`, `van2-stale-edit-rejected-ec1b110.png`,
`van2-completed-reloaded-ec1b110.png`, and known-ID JSON under `artifacts/uat/resume-van2-*`.
Same-session two-tab stale edit smoke PASS; separate browser/device contexts pending.
Earlier “Van 2 not executed”, picker open and Details/label pending statuses are superseded.

### Recovery infrastructure configuration and limits

Both existing-token, staging-only jobs now exist and are ENABLED in europe-west4:

- `fika-logistics-projection-outbox-recovery`: POST
  `https://staging-os.fikacatering.com/api/internal/logistics-outbox`.
- `fika-cpu-durable-outbox-recovery`: POST
  `https://cpu-staging.fikacatering.com/api/internal/durable-outbox`.

Each runs every minute, Europe/London, with `{"limit":25}`, 180-second deadline,
three retries and 30–300 second retry backoff. Uses existing token version 3, no
new secret, IAM, account or grant. Manual runs returned HTTP 200 at 12:45:44Z Hub
and 12:45:53Z CPU; automatic invocations also returned HTTP 200 at 12:53/54/55Z.
Evidence `artifacts/uat/resume-scheduler-success.json` retains safe job names,
timestamps and statuses only. Enabled/authenticated/bounded invocation PASS.
Controlled retryable-obligation recovery remains LIVE RETEST PENDING: scoped
owned CPU obligations were already delivered; bounded Hub dead-letter query found
zero. No green event reset or artificial failure introduced to manufacture PASS.
Hub exact-event review of the owned cancellation displays Delivered/no reset:
review PASS, actual dead-letter reset/delivery still pending.

### Hosted Grab & Go durability remediation

Delivered-In owns the source, history and handoff obligation. Hub owns canonical
Production; the existing external materialisation DTO and downstream ownership
remain unchanged. A hosted source mutation now atomically commits its source and
one immutable event per source version, including actor and payload. Failure after
commit returns saved/pending and keeps a leased, backoff-controlled retry obligation.
Normal site-authorised retry is exact current source-version CAS; it may lazily
materialise a missing historical obligation without changing source/history.
Worker admission is server-side service authentication, limit 1–25, one bounded
indexed eligibility query. Delivered/dead-letter rows have no top-level eligibility
field, so terminal history cannot starve due work. Ten failed attempts require
administrator intervention, not a silent reset. No timer-only/browser retry reliance.
Cold source save reads two deterministic documents and atomically writes source+
event; delivery uses direct claim/settle reads; warm delivered replay does not forward.
No full source scan, new polling or duplicate audit store.

Hub rejects older source versions transactionally by returning the current order.
A delayed submission/amendment cannot overwrite later withdrawal. Existing source
and destination IDs remain stable; Xchange local-fulfilment exclusion unchanged.
UI provides Retry production update and persistent saved/pending or review feedback
after data reload, with accessible semantic warning status and existing light controls.
Style Guide compliance PASS; no native dialogs or authority broadening.

Validation: 7/7 focused source/route regressions PASS (atomic rollback, failed network
recovery, immutable payload, concurrent claim, historical cancellation CAS, internal
admission/query bounds, cross-site denial, expired lease and late-ack protection).
Hub provider/consumer regressions 27/27 PASS against isolated emulator, including
both Grab & Go and Menu late-version-after-cancellation tests. Both app typechecks
and production webpack builds PASS. Isolated rendered Chromium saved/pending/retry/
intervention feedback PASS; `artifacts/uat/grab-handoff-ui.png`. Local mocked APIs
only; this is not staging end-to-end evidence.

Delivered-In full suite: **128 tests, 123 PASS, 5 FAIL, zero skips**. The same five
fail with the exact pre-fix store source loaded without modifying the checkout.
Logs: `resume-grab-full-tests-final.log`, `resume-grab-baseline-tests.log`.
The first baseline harness parsed generic TypeScript as TSX; corrected parser mode
then executed the real tests. Initial UI harness assumed a spinbutton; corrected
to the actual Increase stepper. Neither failed harness is called green.

| Existing failing Delivered-In test | Exact error |
| --- | --- |
| corrupt Grab & Go SQLite recovers from the preserved JSON source without returning an empty list | Grab & Go operational persistence is unavailable; cause `file is not a database`, `ERR_SQLITE_ERROR`, errcode 26 |
| Delivered-In consumes one gzip/base64 week packet and retains allocation portions | `TypeError: Cannot read properties of undefined (reading 'days')` |
| Delivered-In filters by stable OPLOC ID and never by destination label | same TypeError |
| Delivered-In consumes the shared Menu Planning packet envelope | same TypeError |
| a newer withdrawn day in the weekly packet hides older published bytes | same TypeError |

The four packet tests use September dates outside the current October operational
horizon; the SQLite recovery fixture has no preserved JSON seed. These are baseline
test/fixture findings, not waived RC gates. The earlier full Hub 488/476/12 exact
name/error register remains authoritative; the full Hub suite has not been rerun
after this source-version guard. Focused provider/consumer validation is green.

**CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING.** Resulting exact
commit and rollout status will be recorded after push. New worker endpoint:
`/api/internal/grab-and-go-outbox`. Its staging Scheduler is not configured yet.
No owned live G&G submit/amend/cancel was started during this remediation.

### Remaining launch gates and execution order

No P0/P1-zero assertion: historical retired Hospitality downstream recovery remains
unresolved; merged Logistics membership and live exact dead-letter recovery remain
pending. Menu truthful handoff feedback/retry and CPU visible-screen durable-head
freshness fallback remain unremediated confirmed P1 work. Shared production AUTHMOD
identity must be formally configured by its owner; no physical-driver account/grant
is required or authorised. No permanent identity was inferred from current UAT access.

Next: deploy exact `ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe` to Hub and Delivered-In staging only, verify both READY/current/100%, then configure/verify the bounded
Delivered recovery job using existing token version 3, then execute one owned
non-Xchange G&G submit → canonical Production → CPU → Fulfilment → Logistics →
amend exactly once → cancel/withdraw → reload/replay without duplicate/resurrection.
Record exact source/event/order/requirement/job IDs. Do not start it below 10% usage.
Then complete merged Logistics clear/refresh/reconcile/reschedule and separate-context
concurrency; Menu owned week lifecycle/blank/cache/PDF/history/missing/corrupt;
owned allergen revoke/dual re-sign/downstream invalidation; controlled Scheduler
recovery; Auth/OPLOC/date/cache/retry and all baseline test failures. Only then
evaluate RC and align six apps at one validated literal SHA. Audit/readiness scan
remain unexecuted until RC genuinely passes.

Limits: mixed staging SHAs, current UAT session instead of final shared identity,
synthetic internal allergen signatures, email webhook unavailable (queue only), no
controlled dead letter available, and isolated Windows runner restrictions. Existing
ignored evidence is local and must be preserved for a fresh session. Never edit the
protected CHANGELOG/MenuData or clean historical cloud data to improve the matrix.

## Final stop checkpoint — authoritative handoff

Derek requested: “Finish what you are doing and create a checkpoint. Fully update
the autonomous launch UAT MD file and stop.” The active handoff fix is completed,
validated and pushed; no new live journey or remediation is started. **Stopped.**

Latest implementation and fetched `origin/main`/local HEAD before this report-only
checkpoint: **`ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe`** — Persist hosted Grab and
Go production handoffs and reject stale source replay. This is the additional
implementation commit pushed today; together with both commit lists above, every
today's implementation/report push is preserved. The final report-only checkpoint
commit is titled **Save complete autonomous launch UAT resume checkpoint**; it
does not change implementation or deployed source. Its exact final HEAD/origin SHA
is returned in the closing chat after push, avoiding a self-referential commit hash
inside its own content.

**Deployment status of `ceaff01`: NOT SUBMITTED.** User stop supersedes the earlier
plan to deploy/retest next. Therefore Hub and Delivered-In currently serve their
previous validated sources below. No rollout identifier is invented. Grab & Go
remains **CODE FIXED / LOCAL VALIDATION PASS / LIVE RETEST PENDING**. Its recovery
Scheduler has not been created. Do not treat queued/source tests as live proof.

Final read-only current traffic/build API verification, all READY/current/100%:

| App / staging backend | Exact current served SHA | Current build |
| --- | --- | --- |
| Hub / `fika-os-staging` | `3446d5d9b58a5bd363e5655ec74a460bc3ce565d` | `uat-1007132239-3446d5d` |
| Menu / `fika-menu-planning-staging` | `0fd871416ecb548202f6be3c20a75f7d5867253b` | `uat-1007075039-0fd8714` |
| Hospitality / `fika-hospitality-staging` | `03a8249d3639f38c3c87eac3ea24f7b1e14a77f8` | `build-2026-10-06-002` |
| CPU / `fika-cpu-production-staging` | `9aa2cba7d901fd1a69f97d465852758a560abd49` | `uat-1007125522-9aa2cba` |
| Delivered-In / `fika-delivered-in-staging` | `71b2860ac572894d7df6979430ea326edfba0ce1` | `build-2026-10-05-002` |
| Logistics / `fika-logistics-staging` | `ec1b11029beb5c03e7e68cb54c1ca55cc6fbac85` | `uat-1007134501-ec1b110` |

Evidence `artifacts/uat/checkpoint-final-provenance.json`. Mixed commits are
intentional current checkpoint state; no aligned six-app RC exists.

### Exact next task for a fresh session

Fetch origin; read this full report; verify protected hashes and current traffic.
Then deploy **only Hub and Delivered-In staging** at literal
**`ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe`**, using the existing exact-SHA helper:

```powershell
./artifacts/uat/submit-staging-rollout.ps1 -Backend fika-os-staging -Sha ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe
./artifacts/uat/submit-staging-rollout.ps1 -Backend fika-delivered-in-staging -Sha ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe
```

Capture both build/rollout operations, verify actual READY/current/100% before
diagnosis. Configure staging-only bounded Delivered recovery Scheduler POST
`https://delivered-in-staging.fikacatering.com/api/internal/grab-and-go-outbox`
with existing `FIKA_INTERNAL_API_TOKEN@3`, every minute, `{"limit":25}`, preserving
existing authority; verify its actual accepted invocation. Confirm the friendly
Delivered-In URL from the launcher/backend before configuring the target; the
URL above is the existing documented staging route, not a new environment.
Then start one clearly owned non-Xchange G&G submit/amend/cancel journey through
normal authorised UI, and trace exact source/event/Production/Fulfilment/Logistics
IDs with reload/replay checks. Preserve Xchange exclusion. No new driver grants,
shared account guessing, direct cloud repair or production action.

After that, follow the remaining ordered launch gates above. Do not repeat passed
Van 1/Van 2 execution unless later source changes affect it. Human preparation
still needed: formally identify/configure the final shared Logistics AUTHMOD
account, and approve a governed recovery plan for the separate historical retired
Hospitality work. Neither permits arbitrary new UAT authority or history deletion.

Final integrity before report-only commit: `git diff --check` PASS, `git fetch
origin` completed, local HEAD = origin/main = `ceaff01a5f3f3b78a9ef5b0db070fc3f03430afe`.
Only `CHANGELOG.md` and `sites/mnk/booking-platform/01_MenuData.js` remain dirty;
unchanged SHA256 values are exactly the initial protected hashes above. They were
never staged, reset or committed. CHANGELOG updated: **no — explicit protection**;
this report records the task. Final fetch/status/hash verification is repeated
after pushing this report-only checkpoint. Local UI server and isolated Firestore
emulator were stopped; no UAT worker/test remains running locally. Existing
authorised staging recovery jobs remain enabled as intended.

No RC freeze, formal forensic audit, final six-app RC regression or Go-Live
Readiness Scan occurred. Production remains untouched.

**CHECKPOINT SAVED — SAFE TO RESUME AUTONOMOUS UAT**
