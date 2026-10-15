# Hub + Hospitality final UAT integration

Date: 2026-10-15. Branch: `codex/hospitality-uat-integration`.
Starting `origin/main`: `3a3c51d91cba03f9ad95c0985ea1853568234651`.
One integration commit is the source for BOTH Hub and Hospitality; use its full Git SHA for each eventual staging rollout. No deployment or merge to main is part of this task.

## Sources and deliberate overlap resolution

- `7c9af831ce3a09b0a464abd32bbc82a277c8cbd9`: chronological requested-item view, no service picker/drill-down, shared quote/run-sheet branding.
- `a6e4b12d15b22f72a95fb3ba77f70559474226e9` (including `e6d2173347590c6fff9bc81cf6ed63e2e5f75af6`): one booking-level Production panel/action, per-service eligibility, partial retries and Delivered-In production. Required group ingestion/projection/immutable quote workflow and branding/labour dependencies were ported from this release lineage.
- No complete commit/branch was blindly cherry-picked or merged. Dashboard conflicts were resolved in favor of the chronological commercial list plus ONE production panel. The old per-service Send to CPU cards, service selector and redundant production controls were removed. Run-sheet and presentation tests use the presentation line; CPU tests cover the new panel and retry behavior.
- Current main's canonical catalogue engine, stale-plan apply guards, reviewed routing UI/suggestions, schema extensions and merge history remain unchanged. There is no site-copy bootstrap, collection-wide routing scan or automatic classification.
- `explicitMenuProductionRouting` delegates to main's merge-aware resolver without legacy fallback. Canonical menu references take precedence over source-only compatibility lookup keys. The handoff reads routes and merges inside the order transaction, so concurrent decision changes participate in Firestore retry/conflict handling.
- Preserved main's source/provider identity and CPU transport. Unrelated release menu-format, CPU outbox redesign, Gallagher dashboard and hosting/production configuration were excluded. Main's existing single menu-generation format remains unchanged. Quantity/portal and governed labour dependencies were included to keep the approved grouped booking dashboard coherent; historical saved commercial charges remain readable.

## Cross-app contract and behavior

Hub owns routing and projects `cpuRouting` and grouped services. `apps/shared/hospitality-routing-contract.ts` is the shared per-line/read DTO, consumed by Hub and Hospitality. `hospitality-group-quotes.ts` supplies the additive group read shape. Hospitality proxies Hub responses; it does not persist a second routing truth.

All three CPU workstreams (`sandwiches`, `hospitality`, `delivered_in`) are explicit. A saved empty routing decision means No CPU. Missing, invalid and conflicting decisions remain unavailable/unresolved; no default can classify a governed item as No CPU. RCoA is governed by default; other platforms retain the existing `enforced: false` compatibility policy until explicitly governed.

Historical merged Item IDs resolve survivor routing without exposing superseded decisions. Grouped bookings retain independent canonical child booking/quote/Production Order identities. One user action orchestrates eligible child commands sequentially; partial failure leaves successful services intact and retry sends only pending/failed children. Production Orders and durable domain/fulfilment evidence use the existing authoritative transactional path. No CPU services have no handoff, allergen/menu lookup or active generation controls.

## Validation

- Hospitality `npm test`: **180 passed, 0 failed** (includes chronological presentation, shared run sheets, panel locks, Delivered-In, failures/retries and labour/quantity/portal regressions).
- Hub affected suites: **165 passed, 0 failed**. Command: `npx tsx --test --test-force-exit` over `tests/hospitality*.test.ts`, `production-domain.test.ts`, `quote-engine.test.ts`, `booking-workflow.test.ts` and `booking-email-firestore.test.ts`.
- Full Hub suite: **609 total, 596 passed, 13 failed**, using `npx tsx --test --test-concurrency=1 --test-force-exit tests/*.test.ts tests/*.test.cjs`. Failure names exactly match the existing unchanged-main evidence at `3a3c51d` / its `615cd9b` source baseline; no new failures. These are the previously documented address acceptance, session cookie, canonical-boundary/completeness, Connections CSS/confirmation, three Delivered-In access, Logistics trace, two Service Definition and staffing source-contract failures. The full suite is NOT reported green.
- Both apps: `npm run typecheck` and `npm run build` passed. `git diff --check` passed.
- Database tests used only a fresh, disposable Firestore emulator at `127.0.0.1:8905`, project `demo-fika-os`, with explicit `FIKA_UAT_INTEGRATION_EMULATOR_TEST=true` and `FIKA_GROUP_QUOTE_EMULATOR_TEST=true`. No staging/production database was contacted or modified. Emulator state is not exported.
- New cross-app regression exercises the actual Hub workspace/route projection and transactional Production Order creation with Hospitality's real planner/orchestrator. It proves chronological group presentation; canonical references from another origin site; historical merged routing; explicit No CPU exclusion; three CPU workstreams; unresolved refusal; separate child orders; injected partial failure; retry of only the failed child; and no duplicates after a further retry.
- Group quote tests cover immutable snapshots, stale versions, atomic child readiness, artifact retry/lost responses, corruption fail-closed and real Firestore transaction replay. External Drive/rendering calls are fault-injecting adapters; no live Drive writes or external CPU rollout is claimed.

## Read shape, audit and UI

Workspace routing adds direct merge/route document reads only for distinct requested canonical IDs and resolved chains, coalesced within one request (depth bounded to 32). No polling/listener or recurring write is added. Group projection adds at most one head and one latest quote document per group, in batched direct reads. Command membership queries are bounded to the validated group (at most 13 rows); order handoff reads only the affected booking, route/merge chain and required order/fulfilment state. There are no routing collection scans in the handoff transaction.

Group quote audit records append atomically with prepare/retry/supersession/completion and preserve actor, stable child/group/quote IDs, source hash, versions and attempts. Existing order/fulfilment audit evidence remains authoritative.

Style Guide compliance: **PASS**. Reused light operational surfaces, semantic tokens, status text, focus styling and 44px primary controls. Quote/run-sheet mastheads retain the approved document branding. No dark UI island or new palette is introduced.

## Staging handoff and recommendation

The code pair is compatible and ready for review. **Not ready for unconditional staging deployment until Hub renderer/OPLOC Drive bindings are verified**: the ported Hub-owned group quote workflow requires `FIKA_PDF_RENDERER_URL`, `FIKA_PDF_RENDERER_TOKEN`, the DWD credential and the governed OPLOC Drive owner/folder. Current checked-in Hub staging configuration does not declare those bindings (Hospitality declares its existing renderer). Do not assume bindings exist from a local build. Verify/set the staging-only bindings and access grants separately before an authorized rollout; no production configuration or secret was inspected/changed here. The inherited 13 broad Hub failures also remain visible for release acceptance.

No application data was migrated, no catalogue merge/review group was applied, no routing data was changed outside disposable tests, no branch was merged to main and nothing was deployed. Stop after pushing this integration branch for review.

## Exact integrated files

### Hub

- `apps/integration-hub/app/api/bookings/mnk/route.ts`
- `apps/integration-hub/app/api/hospitality-booking-groups/quote/route.ts`
- `apps/integration-hub/docs/hospitality-group-quotes.md`
- `apps/integration-hub/lib/booking-workflow.ts`
- `apps/integration-hub/lib/connections-service.ts`
- `apps/integration-hub/lib/hospitality-additional-charges-schema.ts`
- `apps/integration-hub/lib/hospitality-additional-charges.ts`
- `apps/integration-hub/lib/hospitality-booking-service.ts`
- `apps/integration-hub/lib/hospitality-cpu-routing.ts`
- `apps/integration-hub/lib/hospitality-group-commercial.ts`
- `apps/integration-hub/lib/hospitality-group-projection.ts`
- `apps/integration-hub/lib/hospitality-group-quote-artifact.ts`
- `apps/integration-hub/lib/hospitality-group-quote-document.ts`
- `apps/integration-hub/lib/hospitality-group-quote-store.ts`
- `apps/integration-hub/lib/hospitality-group-quote-workflow.ts`
- `apps/integration-hub/lib/production-domain.ts`
- `apps/integration-hub/lib/quote-engine.ts`
- `apps/integration-hub/tests/booking-email-firestore.test.ts`
- `apps/integration-hub/tests/booking-workflow.test.ts`
- `apps/integration-hub/tests/hospitality-additional-charges.test.ts`
- `apps/integration-hub/tests/hospitality-booking-group.test.ts`
- `apps/integration-hub/tests/hospitality-cpu-routing.test.ts`
- `apps/integration-hub/tests/hospitality-group-quotes.test.ts`
- `apps/integration-hub/tests/hospitality-uat-integration.test.ts`
- `apps/integration-hub/tests/quote-engine.test.ts`

### Hospitality

- `apps/hospitality-booking/app/api/allergen-matrix/route.ts`
- `apps/hospitality-booking/app/api/booking-groups/quote/route.ts`
- `apps/hospitality-booking/app/api/bookings/rcoa/group/route.ts`
- `apps/hospitality-booking/app/api/bookings/rcoa/route.ts`
- `apps/hospitality-booking/app/api/bookings/route.ts`
- `apps/hospitality-booking/app/api/quotes/drive/route.ts`
- `apps/hospitality-booking/app/ui/BookingPortal.tsx`
- `apps/hospitality-booking/app/ui/BookingProductionPanel.module.css`
- `apps/hospitality-booking/app/ui/BookingProductionPanel.tsx`
- `apps/hospitality-booking/app/ui/HospitalityDashboard.module.css`
- `apps/hospitality-booking/app/ui/HospitalityDashboard.tsx`
- `apps/hospitality-booking/app/ui/HospitalityGroupDetail.module.css`
- `apps/hospitality-booking/app/ui/HospitalityGroupDetail.tsx`
- `apps/hospitality-booking/app/ui/HospitalityWorkspace.tsx`
- `apps/hospitality-booking/app/ui/RcoaBookingPortal.module.css`
- `apps/hospitality-booking/app/ui/RcoaBookingPortal.tsx`
- `apps/hospitality-booking/app/ui/RequestedItemsList.tsx`
- `apps/hospitality-booking/app/workspace/page.tsx`
- `apps/hospitality-booking/lib/booking-presentation.ts`
- `apps/hospitality-booking/lib/canonical-types.ts`
- `apps/hospitality-booking/lib/cpu-production-plan.ts`
- `apps/hospitality-booking/lib/labour-rates.ts`
- `apps/hospitality-booking/lib/local-pdf.ts`
- `apps/hospitality-booking/lib/quantity-entry.ts`
- `apps/hospitality-booking/lib/quote-document.ts`
- `apps/hospitality-booking/lib/rcoa-all-day.ts`
- `apps/hospitality-booking/lib/rcoa-booking-group.ts`
- `apps/hospitality-booking/lib/rcoa-booking-request-client.ts`
- `apps/hospitality-booking/lib/rcoa-booking-request.ts`
- `apps/hospitality-booking/lib/rcoa-portal.ts`
- `apps/hospitality-booking/lib/run-sheet.ts`
- `apps/hospitality-booking/public/brand/rcoa/rcoa-logo-white.svg`
- `apps/hospitality-booking/scripts/generate-quote-brand-assets.mjs`
- `apps/hospitality-booking/tests/allergen-matrix-access.test.ts`
- `apps/hospitality-booking/tests/booking-presentation.test.ts`
- `apps/hospitality-booking/tests/calendar-layout.test.ts`
- `apps/hospitality-booking/tests/group-cpu-production.test.ts`
- `apps/hospitality-booking/tests/hospitality-group-dashboard.test.ts`
- `apps/hospitality-booking/tests/labour-calculator.test.ts`
- `apps/hospitality-booking/tests/mnk-contract.test.ts`
- `apps/hospitality-booking/tests/quantity-entry.test.ts`
- `apps/hospitality-booking/tests/quote-branding.test.ts`
- `apps/hospitality-booking/tests/quote-document.test.ts`
- `apps/hospitality-booking/tests/quote-flow.test.ts`
- `apps/hospitality-booking/tests/rcoa-all-day.test.ts`
- `apps/hospitality-booking/tests/rcoa-portal.test.ts`
- `apps/hospitality-booking/tests/rcoa-submission-routing.test.ts`
- `apps/hospitality-booking/tests/run-sheet.test.ts`

### Shared contracts, assets and evidence

- `CHANGELOG.md`
- `apps/shared/hospitality-group-quotes.ts`
- `apps/shared/hospitality-labour-rates.ts`
- `apps/shared/hospitality-quote-brand-assets.generated.ts`
- `apps/shared/hospitality-quote-document.ts`
- `apps/shared/hospitality-routing-contract.ts`
- `docs/architecture/hospitality-uat-integration.md`
- `packages/server-shared/package.json`
- `packages/server-shared/src/hospitality-catalogue/rcoa-hospitality-menu.v1.json`
- `packages/server-shared/src/pdf-renderer.ts`
