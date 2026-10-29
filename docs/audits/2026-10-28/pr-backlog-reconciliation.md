# Open PR reconciliation — 2026-10-28

## Baseline, scope and method

This is a bounded PR backlog audit, not a whole-platform forensic or live-release certification. Read-only Phase 1 was completed before reconciliation. Root/app guides, Style Guide, audit protocol and logging strategy were consulted; later changes use separate governed workspaces. No migrations, deployments, operational writes, infrastructure changes or branch/history deletion are authorised or performed.

- Fetched `origin/main`: `c7847a35767bfbb2fb944e1b975e1144b77b60f0`, including merged Rotations API #105. The canonical checkout itself was at `18b1f644`; all implementation comparisons use the fetched ref and isolated baseline worktree, never that older checkout as source authority.
- Audit workspace: `pr-backlog-audit`, owner `codex-pr-reconciliation`, branch `codex/pr-backlog-audit`; source scope is this report only.
- CPU reconciliation: `cpu-range-reconcile`, same owner, baseline `c7847a35`, scoped to CPU page/tests; final change is tests/changelog only. Its PR is #110, source `031d9f3527f9e764cbd8476e4deb727533681b80`.
- Runtime: Node `v24.21.0`; isolated dependencies/build output. Browser validation uses synthetic GET responses on the allocated local CPU port 14083; no operational backend is contacted.
- All nine initially open PRs were inventoried. Their original diffs, issue inventory and metadata snapshot are preserved in `C:/Fika/_scratch/pr-backlog-reconciliation-2026-10-28/`.
- Actual conflicts were calculated using `git merge-tree --write-tree --name-only origin/main origin/<branch>` without altering a checkout or merging an old PR. GitHub mergeability/CI is recorded separately, especially for the #42/#43 stack.
- Historical CI/deployment claims are explicitly labelled; test results quoted below were independently run only where stated. PR #98 and #106 are inspected at metadata/file-inventory level and not modified.

## Reconciliation table

| PR | Original purpose | Status against baseline main | Actual conflicts | Head CI | Action/blocker | Recommendation |
|---|---|---|---|---|---|---|
| #8 | Recover CPU Totals native date-picker input and add custom-range edge cases | Current #15 week/day Totals redesign already handles input-only and change-only events in actual-page desktop/touch Chromium tests; useful edge-case coverage was absent | CPU page and range test are substantive overlaps with newer navigation/day-selection code; root changelog mechanical | Historical green gate at `719d9856`; replacement #110 exact-source green | Test-only #110 merged at `bb29da03`; old PR closed with replacement comment | CLOSE — performed |
| #13 | Report committed AUTHMOD app-access saves correctly when package publication fails | Missing: main still bootstraps the package after the transaction and before invalidating reference/admission caches; its route/UI do not implement committed-warning handling | Root changelog only; code auto-merges, which does not prove security/runtime correctness | Historical red gate: Hub 777 pass / 38 fail / 60 skip; emulator job green | Retained. Rebuild narrowly with real transaction/HTTP/cache-fence failure tests; do not absorb a broad auth change solely to clear mechanical conflicts | REBUILD |
| #20 | Compact V3 density, resizable inspector and Mon–Fri ribbon | Missing: `WeekRibbon.tsx`, `week.module.css`, resizer hook/control and associated styling are absent; Phase B runtime remains | Root changelog only; `app/page.tsx` auto-merges with newer changes | Historical green gate; historical App Hosting check succeeded, not current serving evidence | Retained draft. Re-specify against the owner's latest van-based timeline; do not reinstate a run-centric week ribbon or old page wiring by default | RETAIN / focused REBUILD |
| #22 | Allow Logistics' expected AUTHMOD redirect during release health checks | Superseded by merged #53 (`cf1cab1b`), whose staging-only probe is stricter | Release implementation/tests substantive; root changelog mechanical | Historical green gate | Closed with explanatory replacement comment; current probe suite independently passed 15/15 | CLOSE — performed |
| #30 | Site-scoped Hospitality Gmail From/Reply-To/mailbox allowlists and launch cutoffs | Partial prerequisites exist: durable email lifecycle, RCoA exclusions and OPLOC allowlist. New sender-identity module, per-site mailbox trust and cutoff rules are missing | Root changelog only; code/config auto-merge | Historical red gate: emulator 28/29; `DELIVERY_WEEKEND` fixture rejection corroborated in logs | Retained. Separate code-only sender/guard work from production YAML/operator mailbox enablement; no sending/configuration in this cleanup | REBUILD |
| #42 | Two-role Ad-Hoc signing lineage and PDF-only checker through CPU Drive | Generic signing/PDF infrastructure exists, but Ad-Hoc lineage, predicate and PDF-only branch are missing | Root changelog only; no substantive textual conflict | Historical red gate: CPU green, Hospitality staging-configuration test fails | Retained draft. Safety-sensitive release changes plus CPU/Hospitality staging YAML; Hospitality lease is active and infrastructure changes are outside this task | REBUILD separately |
| #43 | Surface current Ad-Hoc signed checker via CPU→Hub projection and requester link | Missing projection/reporter/UI. Current canonical Production Order and release infrastructure are prerequisites, not equivalent implementation | Clean against actual #42 base; hypothetical direct-main merge conflicts in root changelog and includes #42 | No CI because stacked base; no main-source gate | Retained on #42. Known best-effort revocation gap and absent route-auth coverage must be addressed; never merge directly to main | RETAIN behind #42 |
| #98 | Menu Planning spelling flags, category headers and theme-day contract | Unmerged work, owned by active Menu Planning agent | GitHub mergeable at inspected head `85199dcf`; no merge attempt | Green exact-head gate | Untouched: active lease `menu-spellcheck-continue`; related layout issue #107 is not authority to absorb this work | RETAIN — protected |
| #106 | Hospitality Rotations dashboard/proxy foundation | Consumer work depends on #105's merged shared/provider contract | GitHub mergeable at inspected head `dc14cb6d`; draft | Green exact-head Hospitality gate | Untouched: active `hospitality-rotations-dashboard-ui`, Luna's integration boundary | RETAIN — protected |

CI statuses above describe the inspected original heads, not newly validated merge candidates. Only #110 and this report's eventual PR are new current-main candidates. No original old head is merged during reconciliation.

## Evidence and exact changed-file boundaries

### #8 — current behaviour versus old handler assertions

Original files: `CHANGELOG.md`, `apps/cpu-production/app/page.tsx`, `apps/cpu-production/tests/production-totals-range.test.ts`. Original branch `codex/cpu-totals-custom-range`, head `719d9856716f37ceba76e05e41776fdf4b1aec8e`; registry workspace `cpu-totals-custom-range` is finished under `codex-cpu-totals-custom-range`.

The original diff adds `onInput` beside `onChange` and layout-source assertions. Merged #15, commit `966f28db` / merge `ee05aff0`, replaced the preset interface with week navigation, selected-day controls and custom-range expansion. Current `app/page.tsx` retains controlled From/To inputs and authoritative bounded projection loading. Replacing its older code wholesale would lose these improvements. Explicit browser events set the native input value and dispatch **only input**, then **only change**; the actual table includes precisely 26–27 October, then only 27 October, and rejects a reversed range. This passed on baseline before editing production source, and on desktop plus 390px touch Chromium. No physical iOS/WebKit claim is made; a concrete browser-specific reproducer should become a separate focused issue rather than a reason to restore the old layout.

Reconciliation #110 contains only the existing range test, new opt-in `production-totals-input.browser.test.ts`, and unique CPU changelog fragment. No page, business rule, calendar, quantity, persistence or contract modification was necessary.

### #13 — post-commit publication is still a distinct failure boundary

Changed paths: root changelog; `apps/integration-hub/app/api/authmod/accounts/[id]/actions/route.ts`; account `AccountDetail.tsx` and new `action-response.ts`; `lib/authmod-core/commit-publication.ts`, `firestore-repository.ts`, `index.ts`; `tests/authmod-app-access-persistence.test.ts`. Branch `claude/cfc-app-access-persistence-f798ea`, head `38b4fbfae169d355311a0de56ddf989eb62c6e33`; no matching governed lease record was found, and no active lease covers these paths. That is not proof that the historical branch can be overwritten.

Main `firestore-repository.ts` `saveStandardApplicationBundle` and `revokeStandardApplicationBundle` commit assignment/grants/security head/audit, then call `bootstrapAuthmodAccessPackage`, then invalidate caches. `authmod-access-read-package.ts` rejects inactive identities with `AUTHMOD_IDENTITY_INACTIVE`. Therefore the intended resilience fix is genuinely absent, not obsolete. Historical Hub failures include missing pinned ADDR-001 specifications and long-running Firestore worker/booking tests; this audit does not attribute every failure to the PR or waive them. Its new tests use memory repositories and publication callbacks rather than proving the real HTTP/transaction/security-head path.

Follow-up: fresh narrowly leased Hub branch; invalidate caches after the authoritative commit regardless of publication success; distinguish pre-commit rejection from committed-but-unpublished warning; leave access evaluation fail-closed on stale/missing packages; verify inactive identities, revocation, head fencing, optimistic conflict, replay and HTTP/UI feedback on an isolated emulator. Do not change #105 resource names, action semantics or Rotations grants. Run Hub suite/emulator/typecheck/build and exact-source CI before merge.

### #20 — presentation work is not obsolete, but requirements have moved

Changed runtime paths under `apps/logistics/app/journey-planner/`: `JourneyPlannerLive.tsx`, `JourneyPlannerShell.tsx`, `JourneyTimeline.tsx`, `RunInspector.tsx`, new `WeekRibbon.tsx`, `inspector.module.css`, `queue.module.css`, `shell.module.css`, `timeline.module.css`, new `week.module.css`; also `app/page.tsx`. Tests: `journey-planner-v2-preview.spec.ts`, `journey-planner-v3-capture.spec.ts`, new `journey-planner-v3-density.spec.ts`, `planner-fake-server.ts`; root changelog and 16 PNG evidence files under `artifacts/desktop-review/` and `artifacts/logistics-desktop-uat/visits/`. Branch `codex/logistics-v3-density`, head `a9952c5a6edc35370f3c893d3128d47768685b28`; finished lease owned by `claude-logistics-v3`.

The absent WeekRibbon and inspector resizing prove missing functionality. Main already has newer assignment-conflict diagnostics (`6e67d299`), vehicle entitlement fixes and install/push changes. The owner's latest van-based timeline requirements override any assumption that this old run-centric implementation should be merged simply because source conflicts are mechanical. Open #103 concerns desktop authority versus mobile PINs; #95 concerns loaded/unmark labels. Neither is fixed by this density PR, and neither should be silently included.

Follow-up: retain branch/evidence; first pin the van-row/day-navigation interaction contract, then extract only compatible density/inspector controls in disjoint current-main scope. Preserve visits/load identity, partial assignment, drag timing, warning-first overlaps, return-to-queue and server permissions. Run unit tests plus actual van timeline/visit/mobile browser regressions. No deployment or automatic rollout changes.

### #22 — stricter governed replacement already exists

Original files: `CHANGELOG.md`, `tools/workflow/releases.mjs`, `tools/workflow/releases.test.mjs`; branch `codex/release-probe-authmod`, head `0d4a877e8c58f80c174da01ae2ab863f7b7a42db`; finished `claude-release-probe` lease. Current `releaseHealthProbe` in merged #53 / `cf1cab1b6bc36cf67e7d3dadd0ba0b3a0bcefa5d` accepts only staging's exact HTTP 307, exact three query parameters, canonical staging Hub origin/root, correct backend returnTo and no credentials/fragment. Current tests reject broadened or mismatched redirects.

The older proposal permits 302/303 and production redirects as well. Those broader behaviours are intentionally not preserved as part of the current staging recovery interface; a future production requirement needs separate validation. Closed with comment https://github.com/derekfika/fika-os/pull/22#issuecomment-6478190878. The release test suite was run from the exact baseline audit worktree: 15/15 passed. No release operation was invoked.

### #30 — missing multi-site mail feature, not an enablement instruction

Changed: root changelog; `apps/integration-hub/apphosting.production.yaml`; `lib/booking-email-delivery.ts`, `booking-email-rollout-guard.ts`, new `booking-email-site-identities.ts`, `workspace-gmail-dwd.ts`; new `tests/booking-email-multisite-auth.test.ts`, plus rollout-guard and launch-hardening tests. Branch `codex/booking-email-multisite-v3`, head `846562e529bf5541e4829beaae0ee908452f459b`; finished lease owned by `agent-task`.

Main retains RCoA exclusions, durable delivery and production OPLOC allowlisting. It lacks the five-site identity map, delegated-mailbox trust validation and per-site UTC launch cutoff. The original emulator log shows `DELIVERY_WEEKEND` rejecting a fixture; its ordinary Hub job passed. That explains a concrete old failure, not permission to bypass the gate.

Follow-up: code-only current-main sender-resolution/guard PR with synthetic adapter tests, plus a separately reviewed operator configuration plan. Preserve group-email consolidation, cancellation handling, uncertain-send holds, all seven historical exclusions, Send As validation and exact-site canonical identity/redirect ownership. Fresh isolated-emulator lifecycle tests must use deliberate valid business dates. Production YAML, mailbox delegation, enablement, cutoff values and sending remain outside this cleanup.

### #42 — safety-sensitive signing plus prohibited configuration coupling

Changed CPU files: `app/lib/production-plan.ts`, `app/ui/HospitalityAllergenDetail.tsx`, `apphosting.staging.yaml`, new `lib/ad-hoc-order.ts`, `cpu-allergen-release.ts`, `cpu-consumer-invalidation.ts`, `cpu-release-materialization.ts`, `cpu-review-package.ts`, `production-plan-command-schema.ts`; tests `ad-hoc-signing.test.ts`, `production-plan-route-concurrency.test.ts`, `staging-config.test.ts`. Also root changelog and `apps/hospitality-booking/apphosting.staging.yaml`. Branch `codex/adhoc-signing-pdf`, head `01a47fa92e709b78a61e028a6e510178e7bbf6d5`; finished `claude-adhoc-sign` lease.

Current CPU lineage supports Menu/Hospitality; the Ad-Hoc predicate/lineage and PDF-only artifact branch are absent. The proposed staging owner/folder changes also affect all non-site orders, including Menu Planning, not just Ad-Hoc. Its Hospitality CI failure explicitly names the staging configuration contract. These are substantive domain/configuration concerns even though merge-tree conflicts only in the changelog. Luna currently owns all Hospitality paths, and the user forbids infrastructure changes.

Follow-up: split pure Ad-Hoc lineage/PDF materialisation from Drive configuration; validate frozen matrix/source binding, both signatures, publication only after durable PDF persistence, amendment/material-edit revocation, immutable history, retry idempotency and absence of unintended Delivered-In packets. Verify all directly affected consumers. Do not absorb configuration or touch active Hospitality scope. Production Drive approval and deployment remain separate operator work.

### #43 — retain its stack and repair reliable invalidation first

Incremental changed paths against #42: root changelog; Ad-Hoc `app/order-form.tsx`, `app/styles.css`, `docs/hub-http-contract.md`, `lib/ad-hoc-service.ts`, new `lib/allergen-checker-view.ts`, `lib/destinations.ts`, Next config/env, package script and four tests; CPU production-plan route, new `lib/ad-hoc-allergen-checker-report.ts`, release materialisation and signing tests; Hub orders route, new `app/api/production/allergen-checker/route.ts`, new `lib/ad-hoc-allergen-checker.ts`, production-domain and two route/order tests; shared `ad-hoc-production-contract.ts`. Branch `codex/adhoc-checker-link`, head `74c651e58d0da2fed88e31538f98e1795ddef9a8`; finished `claude-adhoc-sign` lease.

Its actual base is `codex/adhoc-signing-pdf`, not main. A clean merge against that base is not main integration readiness. Main lacks the reporter/projection/UI. The reporter explicitly catches Hub failures and retries only on a later CPU write, so a matrix-only revocation during an outage can leave the requester seeing a signed link indefinitely. The proposed Hub route uses ordinary Hub actor/canonical-edit authority; it has no route-level rejection tests and does not independently verify the reported release against CPU authority. These are pre-integration blockers, not a claim of an exposed main endpoint.

Follow-up after #42: authenticated CPU-specific write authority plus negative route tests; durable revocation/report outbox or authoritative fail-closed freshness check; monotonic release/source/matrix evidence and stale-event rejection; amendment/cancellation and outage/replay tests; current-only HTTPS governed PDF link. Remove unrelated Next/config/script drift when rebuilding. Retarget only after #42 is safely integrated and run exact-source multi-app/emulator CI. No automatic merge to main.

## Protected leases and related issues

At audit start: `menu-spellcheck-continue` (`claude-menu-spellcheck`, all Menu Planning); `hospitality-rotations-dashboard-ui` (`codex-hospitality-rotations-ui`, all Hospitality); `adhoc-launcher-config` (`luna-adhoc-launcher`, Hub staging YAML and its build-config test); `iss-001-di-cache-resilience` (`haiku-iss-001`, all Delivered-In). No shared-package active lease was found. This task did not send commands/messages to those owners or alter their branches/workspaces.

#98 file inventory: Menu spelling panel, week-planner/theme-days, dictionary source/payload/build script, package/lock, three tests and its unique changelog. #106 inventory: Hospitality proxy API and adapter, development preview page/component/styles, UI model/types/access/fixtures, package/lock, UI tests/documentation and its unique changelog. Both remain owned work. The merged #105 shared/provider contract is not changed by this cleanup.

Related issue search covered all five repository issues returned at baseline: #107 Menu layout, #103 Logistics desktop authority, #95 loaded-checkbox naming, and closed #101 vehicle mapping/#93 planner scrolling. The final refresh also found newer #108 (delivery recovery: explicitly links #20 and the complete inspector/van-row requirement) and #109 (public van links incorrectly reaching AUTHMOD on iPhone). They were read and linked in #20's follow-up comment, not absorbed or modified. #109 explicitly remains a separate operational incident; nothing in this PR cleanup establishes that it is fixed. No direct duplicate issue was found for #8/#13/#22/#30/#42/#43. This limited search is not proof that external UAT/snaggings records contain no related reports.

## Deployment evidence — read-only ledger inspection

| App | Fetched staging ledger | Fetched production ledger |
|---|---|---|
| CPU | `f9e51942`, build-2026-10-26-001, SUCCEEDED, PR #64 | `29e19f4e`, build-2026-10-23-002, SUCCEEDED, PR #26 |
| Hub | `652f3014`, build-2026-10-28-002, SUCCEEDED, PR #102 | `c8f20b89`, build-2026-10-22-002, baseline |
| Hospitality | `c8f81e72`, **PENDING intent**, PR #65 | `c8f20b89`, build-2026-10-22-001, baseline |
| Logistics | `361e07c8`, build-2026-10-28-002, SUCCEEDED, PR #100; exact 307 gate recorded | `5348f500`, build-2026-10-19-001, baseline |

These are fetched append-only ledger records, not live Firebase verification. The pending Hospitality attempt is retained unchanged: no retry, reconciliation or abandonment. The historical App Hosting success attached to #20 does not prove that its exact head is currently serving. No merge is described as a deployment. No optional hosted WIF or infrastructure provisioning was attempted.

## Independent validation and completion

- Baseline audit: exact-ref diffs, merge-tree conflict inventories, all original PR metadata/file lists, active leases/finished ownership, related issues, CI failure logs and fetched ledgers inspected. No old PR's source was merged to test its apparent textual mergeability.
- Current release probe: `node --test tools/workflow/releases.test.mjs` in audit checkout, 15 passed.
- CPU baseline and replacement browser test: native input-only, change-only, inclusive and reversed real-page ranges; desktop and 390px touch Chromium, 2 passed, synthetic GET-only API. Physical WebKit/iOS not run.
- CPU focused range/dashboard suite: 13 passed.
- Governed `fika validate` in CPU workspace: 80 workflow tests passed; CPU suite 472 passed, 2 opt-in browser tests skipped; typecheck and production build passed. Logs preserved outside the worktree. No runtime/UI source edits were needed.
- Exact-source #110 CI passed at `031d9f3527f9e764cbd8476e4deb727533681b80`: CPU tests/typecheck/build, tooling, scope and `Workflow / merge-gate` (check `123050504386`, [run 40754443555](https://github.com/derekfika/fika-os/actions/runs/40754443555)). Hub emulator was correctly skipped for this CPU-test-only change. Governed integration merged it as `bb29da03a2666813870c50944538ed3415c3efe4`, retaining the branch. The report branch then fast-forwarded to that main commit for integration without changing its fixed audit baseline.

## Actions and counts

Original backlog: **9 open PRs**. Initial reconciliation checkpoint: **7 retained, 2 closed (#8/#22), 0 old PR heads merged**. New reconciliation #110 merged; this documentation report was preserved uncommitted when P0 #111 interrupted the task. No old branch was rewritten, rebased, force-pushed or deleted.

Remaining actual main-target conflicts: **4** (#13, #20, #30, #42). #43 is clean against its actual #42 base, but blocked by that dependency and its safety/auth gaps; a hypothetical direct-main merge still conflicts and is not authorised. #98/#106 remain mergeable protected work at their inspected heads, neither modified nor integrated by this task.

Actions are visible in the comments: [#8 replacement](https://github.com/derekfika/fika-os/pull/8#issuecomment-6478751607), [#22 supersession](https://github.com/derekfika/fika-os/pull/22#issuecomment-6478190878), [#13 plan](https://github.com/derekfika/fika-os/pull/13#issuecomment-6478786159), [#20 plan](https://github.com/derekfika/fika-os/pull/20#issuecomment-6478786638), [#30 plan](https://github.com/derekfika/fika-os/pull/30#issuecomment-6478787084), [#42 plan](https://github.com/derekfika/fika-os/pull/42#issuecomment-6478787675), [#43 plan](https://github.com/derekfika/fika-os/pull/43#issuecomment-6478788242).

No production domain mutation, cache, recurring read/write, outbox, audit or operational behaviour is changed by this task. GitHub comments/PR state changes and test/report artifacts are the only new persistent effects. Style Guide compliance: PASS for the inspected CPU controls; presentation remains unchanged.

## Resumed delivery checkpoint — 29 October 2026

Recovered this original workspace, branch and report without restarting the completed audit. First resumed main was `1deb7dc87d98e9d60cdca43ecc95aa99b51f30ab`. A subsequent fetch detected merged #106 at `f4af81dddf0aa212c15379dddb9e68c598f05ee2`; the report branch advanced by fast-forward and the AUTHMOD implementation branch merged that main normally. Original PR heads #13/#20/#30/#42/#43/#98 remain unchanged. #8/#22 remain closed. No historical branch or recovery record was deleted.

### Actual delivery progress

- **AUTHMOD #13 / delivery #118: REBUILD implemented as #123**, branch `codex/authmod-save-delivery`. Assignment/grant/audit/security-head transaction remains authoritative; reference/admission caches invalidate immediately after commit. Package publication failures return a saved-account warning, with stale packages denied. Post-commit account-read failures also return explicit committed/refresh warnings without invented account data. Real administrator resolution remains mandatory. New isolated HTTP-handler/Firestore regression covers grant/revoke persistence, cache/head fencing, stale-package denial, successful/inactive publication behavior, optimistic conflicts, unauthenticated rejection and both refresh-failure cases. It is included in exact-source emulator CI. Five unit/response tests plus the emulator case passed. Initial full Hub suite: 829 passed / 103 skipped; typecheck/build and 80 workflow tests passed. The final refresh-failure revision has a fresh full-suite/build and exact-source CI run; final results are recorded on #123. New semantic warning surface: Style Guide compliance PASS. No live assignments or permission configuration changed.
- **Public driver PIN #109: deployment gap reproduced.** Anonymous production `/mobile/van1` and `/mobile/van2`, including the hosted backend URL, redirect to AUTHMOD with `FIKA_SESSION_MISSING`; staging's hosted `/mobile/van1` returns 200 with PIN content. Current main includes exact fixed-vehicle PIN-shell exemptions; recorded production source `5348f500` does not. Preserve desktop AUTHMOD and server-enforced van scope. This calls for a compatible validated release and actual device acceptance, not another parallel PIN implementation. No deployment or PIN mutation performed.
- **#106: MERGED by its owner**, not closed as obsolete. Hospitality ownership remains active for staging/UAT; #119 remains open. Shared/provider #105 is unchanged by reconciliation. No Hospitality files were edited by Sol.
- **#98: CONTINUE**, unchanged source `85199dcf881fe23bbd770f2f2e2e58ed5c858163`. Its old Menu lease was released for the P0, but branch/recovery and staging checkpoint are retained. Reconciliation does not assume this authorises unfinished feature absorption or a deployment.
- **#20: REBUILD** compatible density/inspector changes against #108/#120's van-row requirements. **#30: REBUILD** code-only sender/guard changes, separately from mailbox trust/cutoff/enablement. **#42: REBUILD** safety lineage/PDF slice without unrelated Hospitality/Drive configuration. **#43: CONTINUE** behind #42, with durable revocation and authority gaps still outstanding. No risky conflict was force-resolved.

### Preserve the verified Menu integration

Issue #111 is closed after owner-confirmed publication and live downstream verification. Menu remains source `39f642d190513b8dca612c80635b8f262b0f7f10`, production `build-2026-10-28-001`. The separate owner-authorised operational task `menu-worker-activation`, final `21c62a1b6b00476cb71ceaf87c976d21ae5d61f9`, enabled the existing Menu worker every minute in Europe/London and aligned its deadline to 300s. Fifty queued events delivered; November's 23 orders, 23 Delivered-In date/site allocations across seven sites, 242 lines and 6,613 portions matched canonical IDs, units, allergens and source lineage. [Final incident evidence](https://github.com/derekfika/fika-os/issues/111#issuecomment-6480657597).

The application release ledger correctly records the #112 application release; Scheduler activation is an operational change, not a new app build. Its report/changelog/tooling were pushed on retained branch `codex/menu-worker-activation`; that source commit is not merged into main. This resumed report places the activation evidence in the normal repository delivery record without rewriting release ledgers or altering the working scheduler. Live readback before Cloud authentication expired confirmed ENABLED, one-minute cadence, 300s and successful status. No duplicate activation was submitted in response to the late approval message.

**#114 stays open with only remaining acceptance work:** operational amendments/withdrawals/zero demand and stale safety pointers, plus Logistics reconciliation and Franco's dispatch ownership. Ordinary publication/order generation is recorded as completed, not missing code. #121 broad Dish Library migration remains separate and unauthorised for destructive live writes.

### Delivery register cross-reference

| Issue | Verified source/dependency evidence | Remaining delivery step |
|---|---|---|
| #107 | Unchanged #98 spelling/header/theme-day work | Brian's clarified planner/keyboard/ordering/Full Menu acceptance and deployed UAT; no new import or taxonomy assumption |
| #108 | #20 UI proposal; merged #81 provider-item linking mechanism; new owner PR #125 proposes Munich form catalogue/classification | Compatible inspector/terminology work; preserve #125 ownership, verify its catalogue evidence and outstanding CFC mapping before any new implementation/data repair |
| #109 | Production/staging public-link difference reproduced above | Compatible release, clean/device PIN and cross-van/server-guard checks; keep desktop AUTHMOD |
| #113 | Merged #15 Totals redesign; merged #110 regression | Distinct CPU interface/classification/Run Sheet/tablet acceptance and live verification |
| #114 | #112 plus owner-confirmed production publish and worker verification | Only the amendment/withdrawal/Logistics criteria noted above |
| #115 | Existing Beverage prototype, versions/lifecycle/approval domain tests and five source-evidenced recipes | Verify/implement durable classics catalogue, spirit organisation and explicit FIKA Variation provenance; preferred-style UAT; no unapproved content import |
| #116 | Merged #29 simplified Ad-Hoc workspace | #42 -> #43 safety/checker chain, active staging launcher work, operational lifecycle UAT |
| #117 | Merged #21; current day-copy, paste preview, cross-week and week-copy controls | Site/cutoff/index/502 and live acceptance; active Delivered-In lease respected |
| #118 | #123 current-main AUTHMOD rebuild | Deploy/verify that slice; printer/network and visual consistency remain separate work |
| #119 | Merged #81 mechanism and #106 consumer foundation; #105 provider; new owner PR #125 supplies proposed Munich form/minimum/location model | #125 portal wiring and CPU/Logistics end-to-end checks, supplied form/room evidence, real rotation-owner assignments/UAT and deployment |
| #120 | #20 retained; source has later mobile improvements | Preserve two van rows/multiple runs, redesign inspector, reproduce specific stale mobile status and verify provenance/device UX |
| #121 | P0 canonical lookup defect proved all 87 referenced dishes existed; not a migration | Reconcile actual catalogue and staged rehearsal, then fresh approval before destructive live migration |
| #122 | Historical legacy cutover HOLD evidence | Refresh actual import/trigger/calendar/catalogue/recovery evidence; explicit cutover approval; never disable legacy prematurely |

All relevant PRs and delivery issues received evidence/dependency cross-links. These rows do not assert uninspected requirements are absent from current code or that a merged PR is live.

### Refreshed deployment records and concrete blockers

These are freshly fetched ledger records. The owner refreshed the existing Cloud login on 29 October; read-only Cloud access now works. A fresh allowlisted Scheduler read confirmed the Menu worker is ENABLED, runs every minute and has a 300-second deadline. No duplicate activation, credential changes or production data writes were performed during reconciliation.

| App | Staging ledger | Production ledger |
|---|---|---|
| Hub | **PENDING** source `f4af81dd`, prior verified `652f3014` | `c8f20b89`, build-2026-10-22-002, SUCCEEDED |
| Menu | `39f642d1`, build-2026-10-28-002; previousGood #98 `85199dcf` / build-2026-10-28-001 | `39f642d1`, build-2026-10-28-001, SUCCEEDED |
| CPU | `f9e51942`, build-2026-10-26-001, SUCCEEDED | `29e19f4e`, build-2026-10-23-002, SUCCEEDED |
| Logistics | Owner-approved `8f0047c7`, build-2026-10-29-001, SUCCEEDED; exact served SHA and desktop AUTHMOD smoke verified; see TLS/UAT limit below | `5348f500`, build-2026-10-19-001, unchanged; actual public links previously reproduced HTTP 307 to AUTHMOD |
| Hospitality | **PENDING** source `c8f81e72` | `c8f20b89`, build-2026-10-22-001, SUCCEEDED |
| Delivered-In | `32e25120`, build-2026-10-26-001, SUCCEEDED | `a4339e74` (includes #21), build-2026-10-23-002, SUCCEEDED ledger; scoped menu projections previously verified |

Do not submit competing Hub/Hospitality staging attempts, blindly retry pending releases, or overwrite active staging source. Existing protected leases: Hospitality Rotations, Delivered-In resilience, Hub staging launcher configuration and the Hub Rotations TypeScript build repair. Our AUTHMOD workspace has completed and released its lease; the separate Logistics van-row implementation and this report hold disjoint owned scopes. Production releases remain separate scoped owner instructions; live permissions, catalogue mappings, mailbox/room data and destructive migrations have not been authorised by generic reconciliation.

### Completed AUTHMOD integration

PR #123 merged as `45c6081765c1a944167d7ae21a548f25ed6276ec`; validated source `27441c47996cb11c8a6e1f4735ac362a0a45f061`. Final validation: 830 Hub tests passed, 103 skipped; Hub typecheck/build and all 80 workflow tests passed. Exact-source Workflow run `40828690258` passed, including Hub emulator and merge gate. Original #13 closed with the replacement evidence; its historical branch remains. #118 remains open because this slice has not been deployed and verified operationally. The completed workspace released its lease, retired safely and published its recovery snapshot.

### Reconciliation table refreshed on 29 October

| PR | Original purpose | Current implementation | Actual conflicts / CI | Action and recommendation |
|---|---|---|---|---|
| #8 | CPU Totals date input | Runtime redesign already present; mounted range regression added in merged #110 | Historical branch conflict superseded; replacement green | Closed with replacement evidence; retain history |
| #13 | AUTHMOD committed app-access saves | Implemented in merged #123 | Historical changelog conflict; exact-source replacement green | Closed as superseded by #123; deploy/verify under #118 |
| #20 | Logistics density, inspector resize, week ribbon | Partial newer UI present; separate van-row implementation underway | Substantive incompatible planner layout; old head green | REBUILD compatible remaining slices; retain until fully reconciled |
| #22 | Logistics AUTHMOD health probe | Equivalent stricter merged #53 | Historical conflict superseded; 15 release-probe tests pass | Closed with #53 evidence |
| #30 | Per-site Hospitality senders | Still missing | Conflicting; old emulator CI fails | REBUILD code-only sender/guard slice, then separately approve operational configuration |
| #42 | Ad-Hoc allergen signing and PDF | Still required | Conflicting; Hospitality configuration CI fails | REBUILD safety lineage/PDF slice without coupled configuration |
| #43 | Signed checker link | Still required; stacked on #42 | Mergeable only against #42; no CI | CONTINUE after #42; repair durable invalidation and CPU authority before integration |
| #98 | Menu spelling/header/theme-day work | Existing owned implementation; checkpoint preserved | Mergeable, green at unchanged `85199dcf` | CONTINUE owner development/UAT; no absorption or overwrite |
| #106 | Hospitality Rotations UI | Merged by its owner as `f4af81dd` | Owner-managed exact-source CI; staging build repair still owned | Preserve #105/#106; #119 remains operationally open |

Of the original nine: three closed with replacement evidence, one merged by its owner, five retained. Three retained branches still conflict with main. No branch, workspace history or recovery record was deleted. Reconciliation created #110 and #123 as separate validated replacement PRs rather than forcing old conflicts. This table counts the original backlog separately from new implementation/report PRs.

### Logistics implementation — PR #124

A new current-main implementation in [PR #124](https://github.com/derekfika/fika-os/pull/124), source `8f0047c7a554669237f4a3fe84642095718af5e5`, uses one lane per canonical van with independent runs, overlap subtracks, explicit untimed drafts, stable-ID assignment and the existing command/inspector workflow. This is a partial delivery of #108/#120; #20 stays open for remaining inspector/density requirements. During implementation, current main was also found to generate `/mobile?run=...` driver links, which use desktop AUTHMOD. The adapter now generates `/mobile/van1|van2?run=...&serviceDate=...` only from valid canonical vehicle IDs. Thus #109 includes both an old production deployment gap and a generated-link correction; it is not merely deployment-only. Desktop AUTHMOD and van-scoped server PIN authority are unchanged.

Governed local validation passed all 80 workflow tests, 686 Logistics tests, typecheck and production build. All 83 distinct mounted browser scenarios passed across final runs, including the clean final 24-case real-domain/ordering/collection/retirement/van-lane rerun; six optional capture cases skipped. Fixtures used synthetic APIs and isolated real-domain transactional state. The browser harness now explicitly selects a run for its details and waits for command completion; persistence/no-loss/retry assertions remain. No physical iPhone or production writes were used. [Exact-source Workflow run 40837339738](https://github.com/derekfika/fika-os/actions/runs/40837339738) passed, including merge-gate job `123326059095`; #124 merged as `fb8048d3f990bd9f4082b5a0cc241802852e2b58`. Branch retained. Style Guide compliance: PASS. No recurring read/audit/worker cost was added. Operational issues stay open pending deployment/device acceptance. Logistics staging deployment has been requested separately from source integration; no release is claimed without a governed verified result.

### Next delivery steps and decisions

1. After the Hub owner resolves its pending staging attempt, pin a release candidate that includes #123 and verify grant/revoke from the authorised interface. Do not assume the older pending `f4af81dd` candidate contains the AUTHMOD fix. Keep #118 open through production verification.
2. Stage the independent Logistics van-row/PIN-link candidate with pinned source, then verify both vans, multiple runs, ordering, assignment, refresh and clean mobile PIN sessions. Production approval must cover the complete serving-to-candidate delta; the old production build cannot be described as already fixed. Continue the requested inspector redesign, terminology and mobile stale-state reproduction under #108/#109/#120 rather than merging #20 wholesale.
3. Rebuild #30's code-only sender resolution and configuration guards on current main. Before operational enablement, obtain explicit site sender identities, Send As delegation and approved cutoffs/allowlist; do not send test emails to real recipients. Reconcile CFC/Munich catalogue links using #81's existing canonical mapping mechanism with explicit matched/missing/ambiguous evidence and approved data changes.
4. Split #42 into the safety-signing/PDF provider change, validate immutable matrix/source lineage and durable revocation, then rebuild dependent #43 with CPU-specific authority and fail-closed freshness. Do not retarget/merge the stack out of order. Keep #116 open until actual requester/CPU lifecycle and artifact access are operationally verified.
5. Preserve #98/#106 owner development and staging checkpoints. Broader #121 Dish Library and #122 legacy cutovers require their own evidence and explicit migration/cutover approval. They do not block code-only reconciliation of unrelated features.

No source integration decision is needed for the safe completed slices; governance permits green merge-commit PR integration. Decisions still needed are scoped deployment instructions and actual operational sender/mapping/room inputs or data-change approval. Active owner leases and the pending Hub/Hospitality releases are coordination constraints, not reasons to overwrite or abandon their work.

Final owner-work refresh: [PR #125](https://github.com/derekfika/fika-os/pull/125), head `24cfb9bae7a06bb59dc53c44ad64b7db0f7b1904`, is open for Munich RE form catalogue, contextual site minimums and location modelling. Its body explicitly leaves portal UI, CPU/Logistics end-to-end and staging/UAT unfinished; Hospitality CI/merge gate fail while other affected app/emulator checks pass. These are branch implementation claims, not production verification. Preserve that provider/shared-package work and its owners; do not create duplicate catalogue/minimum/location work from this report's older queue description. No code, data or merge operation on #125 was performed by reconciliation.

### Owner-approved Logistics staging release and final workspace direction

The owner explicitly approved **Deploy Logistics staging** for #124. The governed deployment pinned `8f0047c7a554669237f4a3fe84642095718af5e5`; Cloud serving verification confirmed `build-2026-10-29-001`, SUCCEEDED at 100%. Original release `82bd4a8d-d42e-48ff-9848-2cd8284c5752` initially held on a TLS/request health failure. The journal was preserved; after the exact governed desktop AUTHMOD probe passed (307 with the required staging Hub redirect), governed reconciliation completed that same terminal rollout. No resubmission or replacement deployment occurred. The appended staging ledger is now a completed deploy record. Rollback remains `361e07c8570e887d3adf3668b69afb45917b46a9`, `build-2026-10-28-002`.

Read-only checks observed Van 1 HEAD HTTP 200 and Van 2 GET HTTP 200 with PIN content. Subsequent Windows/Node requests intermittently failed certificate issuer trust (`SEC_E_UNTRUSTED_ROOT` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`), preventing a reliable full anonymous-session/device acceptance pass. Certificate verification was never bypassed. The successful source/desktop smoke is recorded separately from this unresolved client/network observation. No PIN was entered or changed and no operational fixture writes were made. #109/#120 remain open for trusted-device/PIN, cross-van and operational UAT, followed by separately approved production release. Production remains unchanged.

The owner then explicitly requested `workspace complete hospitality-rotations-dashboard-ui`. That lease belonged to `codex-hospitality-rotations-ui`, not Sol. Governed completion with preservation released it and retired the checkout at `dc14cb6db378a3e5b662bce4533cf1d540fbef75`; branch, verified Git bundle, recovery evidence and generated archive were retained. Workspace-status snapshot published as `d925500866e45bc767f46a9f2df5005782dfb5aa`. No Hospitality source, release or data was changed by that administrative completion. Its formerly active app scope is now free; the separate Hub build-repair lease remains owned work.
