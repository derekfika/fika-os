# Claude-led FIKA OS end-to-end UAT plan — 2026-10-17

## Readiness and execution boundary

This is a test plan, not approval to execute production UAT. Begin with comprehensive staging UAT. Production UAT requires a separate written approval after the current cutover blockers are resolved.

Current production blockers:

- Delivered-In's live runtime contains staging Hub URLs. Do not use its dashboard or run integrated smoke until its runtime configuration is corrected and verified at the exact deployed SHA. The initial failed dashboard request forwarded the production session cookie to staging, where it was rejected as invalid; treat session handling as a security incident for operator review.
- Derek's Logistics Hub admission currently has no `permittedVehicleIds`; Logistics denies the planner. Do not weaken AUTHMOD or invent vehicle assignments.
- CPU's “Ad-hoc production” action links to `http://localhost:4000`; avoid it until repaired or explicitly treated as a deferred feature.

Global staging rules:

1. Use named test records with a `UAT-<run-id>` reference and one approved test OPLOC. Record source IDs before creating the next workflow.
2. Complete one connected scenario through its downstream consumers, then withdraw/cancel and reconcile it before starting another.
3. Never delete legitimate history to make the UI look empty. Preserve audit/revision evidence and record residual cache, package, file, outbox or event IDs.
4. Keep email, public notifications, Drive artifacts, dispatch and recovery jobs disabled unless an individual scenario has an approved side-effect plan.
5. A green UI alone is insufficient: verify authoritative source, downstream materialisation, lineage IDs, expected audit evidence and cancellation/withdrawal propagation.

## A. Comprehensive STAGING UAT

### 0. Test setup and identity

- Confirm the tested SHA/build for Hub, Menu Planning, CPU, Hospitality, Logistics and Delivered-In. Record browser, viewport, date/timezone and user identity.
- Use separate test identities for organisation admin, site-scoped operator, CPU reviewer/signer, Logistics vehicle operator and Delivered-In recipient. Exercise missing/expired session and insufficient-scope paths.
- Select one explicitly designated staging OPLOC; verify canonical ID and redirects through Hub. Do not use display names as join keys.
- Confirm staging email and Drive destinations are non-customer test destinations. Record whether a PDF/Drive artifact is generated; disable real email and external dispatch.

### 1. Hub, AUTHMOD and app navigation

- Sign in and sign out; test session expiry, refresh and cross-app navigation among Hub, Menu Planning, CPU, Hospitality, Logistics and Delivered-In.
- Verify identity binding uses the existing canonical identity and audit event; test a duplicate/new-identity denial path.
- Verify each role's app admission, OPLOC scope and sensitive capabilities. Explicitly test denied allergen approval, menu publication and vehicle scope where the identity lacks those grants.
- Test historical OPLOC redirect canonicalisation and fail-closed behaviour for missing or invalid redirects.
- Expected records: session/binding/audit evidence only for auth tests. No booking/order/package business records. Revoke disposable test sessions using the normal session flow; retain append-only binding/audit evidence.

### 2. Menu Planning and Portion Planner → CPU

- Create a UAT menu intent; edit items, portions, service dates and governed destinations. Test stable IDs, duplicate/retry, stale version and an intentionally blank published day.
- Preview quantities and downstream materialisation. Publish one populated day/week and one blank day using an authorised publisher.
- Verify immutable publication/revision identity and source hashes; CPU receives only the exact current publication and creates canonical production work once.
- Amend a published portion/destination; verify a new revision, explicit supersession, stable lineage and downstream amendment. Withdraw the publication and confirm CPU current pointers/work are withdrawn or superseded; republish a valid revision.
- Include a legacy OPLOC alias and verify it resolves to one canonical site. Include historical pre-package input and verify the documented rebuild/compatibility path; corrupt a package in an isolated test fixture and confirm integrity failure remains fail-closed.
- Expected records: menu draft/revisions/publication or withdrawal evidence; CPU handoff/order and derived projections/packages; change/outbox events; possible test PDF if explicitly enabled. Cancellation does not erase these records. Withdraw the UAT publication, reconcile CPU and Delivered-In current views, retain history and record package/object/cache cleanup requirements.

### 3. CPU Production and allergen controls

- Accept the Menu Planning handoff; verify canonical production order ID, source publication ID/version/hash and idempotent retry.
- Plan and edit a test order; exercise optimistic concurrency, blocked/clarification/attention states, completion and cancellation. Verify no order is created from a blank service day.
- Test allergen `UNRECORDED`, `CLEAR`, `CONTAINS` and `MAY_CONTAIN` distinctly. Confirm unsigned/partial review is not presented as signed/current.
- In the approved staging safety scenario, complete required independent signatures against the frozen matrix hash, publish the verified CPU packet, then change allergen truth. Confirm the old release, signatures, packet and current pointers are revoked and a new dual review is required.
- Test corrupted or revoked CPU packets against Delivered-In; they must fail closed. Verify missing-but-rebuildable projection behaviour separately from integrity failure.
- Expected records: canonical order/plan revisions, durable audit/change events, signatures/releases, projection/package heads and immutable objects. If PDF/Drive is explicitly enabled, record file IDs and remove only disposable test artifacts through the approved Drive cleanup process. Cancel/withdraw, invalidate current packages and reconcile downstream; retain signatures and release history.

### 4. Hospitality booking and amendments

- Test booking at the approved test OPLOC: create request, edit customer/service details, pricing, quote, review, send-to-CPU handoff and status transitions. Verify server-owned pricing, actor, immutable commercial snapshot and canonical handoff lineage.
- Test idempotent double-submit, stale quote, grouped amendment, partial completion, cancellation and a cancelled booking arriving after CPU handoff.
- Verify Drive folder/template access read-only first. In staging only, create a quote/PDF if approved; test missing template/Drive denial fail-closed. Test email intent with a non-delivery stub or approved sink, never a real customer.
- Expected records: booking/group revisions, quote/commercial snapshot, audit/change events, CPU order/handoff and optional PDF/Drive file. Cancellation must mark/supersede downstream work and may leave audit, quote, file and event evidence. Reconcile CPU/Logistics/Delivered-In and retain immutable history.

### 5. Logistics fulfilment

- Wait for a real CPU fulfilment requirement; do not fabricate a movement just to populate the planner. Assign test requirements to an authorised vehicle/driver, plan stops and times, alter assignment, transfer/reorder and exercise collection/delivery status.
- Test idempotent commands, stale run/stop version, vehicle-scope denial, missing/invalid vehicle identity, historical OPLOC redirect and a cancellation/amendment after assignment.
- Verify logistics-owned run/stop/movement IDs and change/audit evidence; upstream requirement remains authoritative. Confirm cancellation removes/supersedes stale operational work without deleting history.
- Expected records: run, stop, assignment, movement, projection/cursor/outbox and audit/change events. Do not physically dispatch. Cancel or reconcile the run, preserve audit/history, and remove only disposable draft state through normal governed actions.

### 6. Delivered-In and Grab & Go

- Verify authorised site selector, published/blank menu days, projection freshness, week/day navigation and IndexedDB cache revalidation. Test stale client cache, withdrawal invalidation and explicit unavailable/partial states.
- Verify CPU signed packet binding and allergen acknowledgement boundaries. Test no acknowledgement for unsigned, revoked, incomplete or corrupt packets.
- Verify the approved 21-product Grab & Go catalogue identity and category split (`18 grab_250ml`, `3 stacking_salad_750ml`). Test catalogue-only reads separately from ordering.
- Test one receipt/acknowledgement only if authorised, then exercise an amendment/cancellation; verify idempotency and stable source lineage.
- Expected records: projection indexes/packages, cache entries, acknowledgement/receipt and audit events; possible site-menu Drive artifact only after explicit staging approval. Withdraw/invalidate current projections and reconcile caches; retain audit and immutable package history.

### 7. UI, responsive behaviour and failure paths

- At desktop and mobile widths, verify keyboard focus, contrast, labels, status text, dropdown selection/search, browser back/forward, loading/empty/error states and no stale site data after switching OPLOC.
- Test denied, expired session, unavailable Hub/Menu/CPU service, missing package, corrupt package and retry. Confirm user-visible errors remain clear and do not broaden access or silently show stale data.
- Record screenshots and concise reproduction details for defects. No data mutation is needed for layout/navigation checks.

## B. Controlled PRODUCTION UAT — approval required, not scheduled

Do not begin until Derek approves all of the following in one written production test authorization:

1. **Test site/OPLOC:** exact canonical OPLOC and site owner; confirm the site is designated for production testing and does not represent a live customer service.
2. **Test record identifiers:** reserved prefix/ID plan for booking, menu publication, CPU order, logistics run and Delivered-In receipt. Use stable IDs and preserve cross-app lineage.
3. **External side effects:** explicit decision for email (default OFF), PDF/Drive creation (default NO), real dispatch (default NO), customer/vendor notification (default NO), and any public catalogue visibility.
4. **Cleanup/cancellation:** named operator and exact sequence for withdraw/cancel/reconcile across apps; enumerate residual audit history, immutable package objects, projection caches, outbox/events, Drive files and email/dispatch records. Define which items are retained and which disposable test artifacts may be removed.
5. **Permissions:** named human testers and approved AUTHMOD app/OPLOC/vehicle/capability grants. Do not set `fullAccess=true`; do not grant signatures or publication solely for convenience.
6. **Safety gates:** Delivered-In has no staging URLs and its session handling is verified; Logistics has the required vehicle authority; CPU localhost link is repaired or formally excluded from the production test scope; email remains OFF and recovery jobs remain PAUSED unless separately authorised.

### Production execution order after separate approval

1. Read-only cross-app smoke and source/package integrity checks.
2. One bounded, low-risk menu-to-CPU scenario at the approved test site; verify lineage at each boundary.
3. Complete its withdrawal/cancellation and downstream reconciliation; capture all residual IDs and preserve business audit history.
4. Only after reconciliation is signed off, proceed to one Hospitality booking/handoff scenario.
5. Run Logistics and Delivered-In only against those real upstream test records. Do not create synthetic fulfilment or sign allergen evidence merely to test a screen.
6. Reconcile and close one scenario before starting the next. Stop immediately on wrong project, scope leak, unexpected business write, unsafe external side effect, source-integrity failure or stale-current display.

### Residual-record/cleanup register

For every scenario, Claude records: test run ID; entity IDs and revisions; audit/change event IDs; package/head hashes and GCS object names; Firestore derived projection/index IDs; outbox/cursor IDs; Drive file IDs; email provider message IDs (if separately authorised); dispatch references; cancellation/withdrawal status; current-pointer invalidation; remaining evidence; cleanup owner and completion time. Cancellation is not erasure. Retain legitimate history and perform only explicitly approved cleanup of disposable artifacts.

## Current production rollout snapshot

- Hospitality, Logistics and Delivered-In were each built from exact source SHA `c0df470f95c67dc361b889c453c6a6ad8912efa2`; build IDs are recorded above. Hub, Menu Planning and CPU remain on their earlier independently recorded SHAs.
- CPU derived empty-week data exists for week 2026-10-12; it contains zero orders. The CPU writer role is active. Logistics and Delivered-In writer roles are also active as normal runtime permissions; Hospitality remains without direct Firestore access.
- No integrated six-app smoke or Grab & Go runtime back-check was completed. Email remains OFF; recovery schedulers remain PAUSED; no production business workflow, Drive output or staging data write was performed.
- **Current verdict: HOLD for Claude UAT** until the Delivered-In environment is corrected at source and redeployed, Logistics vehicle access is explicitly governed, and the session-cookie-to-staging incident is reviewed.
