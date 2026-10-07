# Batch 1: vehicle access and governed drivers

## Current policy correction — 2026-10-07

Derek confirmed that driver phones authenticate with one shared authorised Logistics account. Physical drivers do not require individual FIKA OS accounts or `logistics.driver` person grants. Authentication/session authority and operational vehicle/run identity are separate. The person-driver policy documented below is historical and superseded for execution.

Ready/Dispatch and mobile execution use the authenticated operator's existing vehicle entitlements, current canonical ownership and operational readiness/CAS checks. Fixed `/mobile/van1` and `/mobile/van2` views select their vehicle; selection never grants authority. Optional historical driver ID/name snapshots remain audit metadata and are not an execution gate. The legacy explicit driver-assignment API retains its existing validation for compatibility; routine desktop/mobile workflows do not require or query that catalogue.

No identities or grants were created/broadened. Final shared-account configuration is launch preparation; staging UAT is authorised to use the currently authorised existing session. See `docs/uat/autonomous-launch-uat-2026-10-07.md` for validation and deployment evidence.

## Sol review correction — 2026-10-02

Prior reviewed SHA: `f30aa8c824b7e7c750ffe77cbc1e1dcd8eb1ed86`. Canonical base remains `2db66b3903203b5c65d7fc9b99ac8cdd38914252`. This correction is limited to R1 and R2; no new AUTHMOD authority, merge, deployment or operational migration.

R1: `authorizeOwnedOrSharedWork` now requires both explicit vehicle entitlements when canonical current ownership is empty. Job IDs cannot bypass this by supplying an authorised target run. Native requirement assignment resolves existing stop/run owners, and movement assignment resolves existing movement stop/run owners. The transaction repeats these checks against current persisted assignments/stops, before considering buffered proposed writes. Proposed assignments cannot confer authority over formerly unowned work. Existing current/proposed vehicle checks remain intact, and assigned work remains governed by its existing owners. Native requirement ownership reads use only the target operational date's runs and their stops, coalesced once per date in both preflight and transaction; job/movement ownership uses targeted relationship queries. No periodic reads or listeners were added.

R2: entering Ready or Dispatched freshly validates the canonical driver ID against Hub for the canonical run vehicle inside the transaction guard. Ineligible drivers receive 422 with a reassignment instruction; failed commands leave the run's historical driver ID, label, version and audit unchanged. Eligibility validation does not rewrite historical display names. Completion and execution after dispatch do not gain a new driver-authority gate. Mounted desktop and the retained run panel disable Mark ready when the loaded catalogue does not confirm the assigned driver; catalogue attention explains the preserved historical assignment. Desktop has no Dispatch command in these controls; its server boundary is covered explicitly.

Correction validation:

- Logistics `npm run test:authority`: **52 passed**, including shared jobs/native requirements/open movements for restricted and both-vehicle operators, ownership disappearing after preflight for all three work types, retained scoped management, driver revocation before Ready/Dispatch, eligible replacement, snapshot preservation, forged labels, unchanged post-dispatch completion and the original fresh-day flow.
- Logistics `npm run test:access-regression`: **81 passed**.
- `npm run test:e2e -- --project=batch1-authority-chromium --max-failures=1`: **6 passed**, including a loaded valid catalogue changing to revoked and disabling mounted Mark ready.
- Both Logistics and unchanged Integration Hub: `npm run typecheck`, `tsc --noEmit --incremental false`, production `npm run build`.
- `git diff --check`: passed. Style Guide compliance: **PASS**; existing semantic controls/status and layout retained.
- Logistics standard `npm run test` and `npm run test:integration` each attempted once: **ENVIRONMENT-LIMITED**, `uv_os_get_passwd ENOMEM` before execution. No retry or claim of a passing standard/integration suite. Hub authority/regression tests were not rerun because no Hub files changed.
- User CHANGELOG and MNK menu-data edits remain byte-for-byte unchanged and uncommitted; this correction record replaces a changelog edit under the explicit preservation instruction. No deployment.

Exact correction files:

- apps/logistics/app/api/logistics/route.ts
- apps/logistics/app/driver-selector.tsx
- apps/logistics/app/page.tsx
- apps/logistics/lib/authorized-transaction.ts
- apps/logistics/lib/resource-authority.ts
- apps/logistics/tests/helpers/authority-route-harness.cjs
- apps/logistics/tests/resource-authority.test.cjs
- apps/logistics/tests/e2e/authority-drivers.spec.ts
- apps/logistics/docs/batch1-authority-drivers.md

Date: 2026-10-01. Review branch: `review/logistics-a1-a4-authority-drivers`.
Starting origin/main: `2db66b3903203b5c65d7fc9b99ac8cdd38914252`.
Scope: audit findings A1 and A4 only. No deployment, real grants, migration or operational data writes performed.

## Authority ownership

Integration Hub AUTHMOD owns identities, app admission, AuthorityGrants and their evaluation. Logistics owns run, stop, load, assignment and movement state. The shared `apps/shared/logistics-authority.ts` defines the two stable vehicle resource IDs and driver response contract. Directly affected provider/consumer: Integration Hub and Logistics.

Vehicle access is `logistics.vehicle / View / resource [van1, van2]`. App admission and Full Access alone do not grant it. An omitted vehicle query returns the permitted union, never unrestricted data. Both vehicle entitlements permit the organisation planner and shared unassigned work; one entitlement returns only that vehicle's work. Empty/invalid permissions deny reads and ordinary commands. A fixed-van URL is an intersection with existing authority, never an authority source.

Run ownership uses persisted `DeliveryRun.vehicleId`, never vehicleLabel, driverLabel, run-ID parsing or browser claims. Loads validate their own optional stable vehicleId plus every delivery/collection run; mismatches and unresolved ownership fail closed. Stops resolve their canonical owning run. Commands check both source and target and indirectly changed resources. Transaction writes are buffered until current and proposed owners are checked using transactional reads; concurrent ownership changes therefore retry the decision with Firestore. Driver assignment commands also revalidate an unchanged driver ID when explicitly submitted again.

Day/projection/week/attention responses remove out-of-scope runs, stops, loads, assignments, movement details and identifying lineage. Canonical run/load ownership is rechecked before serving projection data, including merged loads whose projection metadata cannot represent all collection owners. Change feeds return opaque freshness cursors and scoped snapshots rather than raw events. IndexedDB cache scope v2 includes the sorted permitted vehicle IDs, so an admission change cannot reuse the old broader cache key. Existing AUTHMOD admission-cache expiry still bounds vehicle/maintenance revocation visibility; direct driver validation bypasses that cache.

Maintenance needs separate explicit organisation-scoped Administer grants: `logistics.repair`, `logistics.reconcile`, `logistics.reset`. Ordinary operators, including both-vehicle operators, cannot invoke repairs, reconciliation, job materialisation or reset merely through vehicle View. Full Access does not imply these special authorities. No privileged grants are seeded automatically.

## Driver policy

`logistics.driver` is PERSON REQUIRED. Eligibility requires an active, effective, matched person identity, an effective explicit Logistics app assignment and an effective `logistics.driver / Contribute` AuthorityGrant with resource IDs van1 and/or van2. Operational identities are ineligible. Vehicle View is independent and is not required for a person to appear in driver choices. A driver's own access to Logistics remains subject to the vehicle-access authority.

Hub's no-store driver API queries only active driver grants and resolves candidate identities by ID through the existing repository/evaluator. It intersects results with the requesting operator's vehicle permissions. Direct driver-ID validation performs fresh authority reads. Logistics submits canonical driver IDs and obtains the current display name from Hub; browser labels cannot override it. Invalid/revoked/inactive/unmatched drivers fail new assignment server-side. Historical run snapshots are preserved when eligibility changes. Catalogue failure blocks new assignment and shows an explicit retry state. New Run, the existing run panel and mounted inspector share this catalogue and filter by selected vehicle. A fresh day needs no previously assigned run to populate choices.

## Required operational preparation (not executed)

1. Deploy the added Hub AuthorityGrant resource/status index through the separately authorised deployment process. The catalogue fetch is capped at 201 records, with 200 the supported active-driver-grant budget; overflow fails explicitly rather than silently truncating.
2. Review and create explicit person driver grants through existing AUTHMOD authority tooling, including the required active app assignments. Configure vehicle View and any maintenance authority separately. No real driver names/identities are hardcoded or populated by this change.
3. Inventory legacy runs and load/run combinations. Runs with only vehicleLabel are quarantined from operational reads and mutations. Day bootstrap returns an identity-review conflict instead of inventing duplicate runs. There is no automatic label-to-ID backfill.
4. After human review of a run's ownership, an explicitly authorised administrator may submit `repair-run-vehicle-identity` with runId, vehicleId and expectedRunVersion. It maps missing identity with compare-and-set, records actor/version evidence and rebuilds the projection through the existing change path. It rejects remapping an existing different stable ID. This support was exercised only against the isolated in-memory test store.
5. Review any mismatched DeliveryLoad.vehicleId/delivery run and cross-vehicle collection references separately. The implementation does not guess or silently repair conflicting ownership. Rebuild affected projections through explicit reconcile authority after approved migration.

## Read shape and cost

Restricted cold day reads use a deterministic date projection and cursor, direct IDs for referenced runs/loads and canonical collection owners; no workforce scan or global event scan. Week reads repeat this for seven dates; attention is capped at fourteen. Warm unchanged UI checks retain the existing head cadence and need only the cursor (legacy head compatibility may additionally read the date projection). Permission evaluation retains the existing admission cache. Driver catalogue reads one bounded active-driver-grant query and candidate-specific identity/assignment/grant/delegation data; a submitted driver ID avoids the catalogue query. The UI coalesces catalogue fetches and refreshes on initial load, selector focus, New Run opening and explicit retry; no new periodic polling or realtime listener is added. Assignment transactions read only affected records and targeted job/movement relationships; the guards preserve transaction correctness over reducing reads.

## Validation

New Logistics tests exercise actual GET/POST/driver handlers, AUTHMOD HTTP adapter and transaction guards against an isolated Firestore-shaped in-memory store. New Hub tests exercise the real repository/evaluator/authority services against MemoryAuthModRepository. The production Chromium checks intercept APIs with synthetic governed identities; they do not write emulator, staging or production data.

Commands and final results:

- Logistics `npm run test:authority`: 35 passed, including ownership changing between preflight and transaction and explicit reassignment of the same revoked driver.
- Logistics `npm run test:access-regression`: 81 passed (auth/middleware, fixed-van/mobile projection, planning, scheduling, dashboard adapter, projection recovery and hosting boundaries).
- Hub `npm run test:logistics-authority`: 15 passed.
- Hub `npm run test:logistics-regression`: 37 passed (existing AUTHMOD core and vehicle entitlement tests).
- Logistics `npm run test:e2e -- --project=batch1-authority-chromium --max-failures=1`: 5 passed, including fresh create, existing-run assignment, unavailable catalogue, historical revoked assignment and fixed-van mobile request scope.
- Both apps: `npm run typecheck`, `tsc --noEmit --incremental false`, production `npm run build` and scoped `git diff --check`.
- ENVIRONMENT-LIMITED: standard Logistics `npm run test`, Hub `npm run test -- --test-name-pattern=vehicle` and Logistics `npm run test:integration` hit `uv_os_get_passwd ENOMEM` before execution. They are not reported as passing. The focused Node scripts use a diskless TypeScript loader to avoid the failing tsx CLI startup. Emulator-backed integration/browser suites remain unverified.

Style Guide compliance: PASS for the changed selectors/popover: existing light surface and semantic tokens, visible labels/status, keyboard focus, Escape/focus return and modal Tab containment. Existing timeline/mobile presentation and cadence were retained. A1/A4 changes do not remediate other audit findings.

The user's root CHANGELOG.md and MNK MenuData edits must remain uncommitted and byte-for-byte unchanged under the explicit task instruction. This document records the task in lieu of modifying that dirty changelog. Deployment status: none.

## Files changed

- apps/integration-hub/app/api/logistics/access/route.ts
- apps/integration-hub/app/api/logistics/drivers/route.ts
- apps/integration-hub/firestore.indexes.json
- apps/integration-hub/lib/authmod-core/authority.ts
- apps/integration-hub/lib/authmod-core/evaluator.ts
- apps/integration-hub/lib/authmod-core/firestore-repository.ts
- apps/integration-hub/lib/authmod-core/logistics-drivers.ts
- apps/integration-hub/lib/authmod-core/memory-repository.ts
- apps/integration-hub/lib/authmod-core/repository.ts
- apps/integration-hub/package.json
- apps/integration-hub/tests/logistics-access-regression.cjs
- apps/integration-hub/tests/logistics-driver-authority.test.cjs
- apps/logistics/app/api/logistics/drivers/route.ts
- apps/logistics/app/api/logistics/route.ts
- apps/logistics/app/driver-selector.tsx
- apps/logistics/app/page.tsx
- apps/logistics/app/styles.css
- apps/logistics/docs/batch1-authority-drivers.md
- apps/logistics/lib/auth.ts
- apps/logistics/lib/authorized-transaction.ts
- apps/logistics/lib/driver-authority.ts
- apps/logistics/lib/planner-read-model.ts
- apps/logistics/lib/resource-authority.ts
- apps/logistics/lib/types.ts
- apps/logistics/package.json
- apps/logistics/playwright.config.ts
- apps/logistics/tests/access-regression.cjs
- apps/logistics/tests/api.integration.ts
- apps/logistics/tests/e2e/authority-drivers.spec.ts
- apps/logistics/tests/e2e/fixtures.ts
- apps/logistics/tests/fixed-van-routes.test.ts
- apps/logistics/tests/helpers/authority-route-harness.cjs
- apps/logistics/tests/resource-authority.test.cjs
- apps/shared/logistics-authority.ts
- scripts/testing/load-typescript.cjs
