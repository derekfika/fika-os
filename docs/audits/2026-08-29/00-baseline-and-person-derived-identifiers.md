# FIKA OS baseline audit — person-derived identifiers

Audit date: 2026-08-29 (Europe/London)
Repository: `C:\FIKA`
Branch: `feature/authmod-access-control`
Baseline commit: `75c3e8d17a36706875925098bcee906b7c33dad7` (`fix(cpu): defer allergen Drive persistence safely`)
Worktree: dirty before audit; pre-existing changes were preserved and not modified.
Runtime observed: Node `v24.14.1`, npm `11.18.0`.

This is the read-only baseline phase required by `docs/ai/CODEBASE-AUDIT-PROTOCOL.md`. No production code, tests, persisted data, or deployment configuration was changed. The only write is this audit report.

## Scope and method

The repository was searched for person names, person-shaped route/view values, email-address routing, identity literals, assignment fields, role checks, and source/provenance labels across the nine application areas, shared Apps Script packages, platform specifications, tests, fixtures, and deployment documentation. Relevant implementation paths were then traced into CPU routing, Integration Hub connections, AUTHMOD identity handling, and shared Calendar/feedback configuration.

## Platform identity model observed

The current canonical direction is already present in Integration Hub AUTHMOD:

- person identities are represented as AUTHMOD identities and may be linked to a Legend;
- operational identities are distinct and use custodianship/operational purpose rather than personal Legend linkage (`apps/integration-hub/lib/authmod-core/identity.ts`);
- access is evaluated through a session principal and permissions/roles (`apps/integration-hub/lib/auth.ts`, `apps/integration-hub/lib/authmod.ts`);
- stable OPLOC and canonical menu-item IDs are available for scoped routing (`apps/integration-hub/lib/production-domain.ts`, `apps/integration-hub/lib/connections-service.ts`).

The CPU menu-production routing seam has not yet been migrated to that model: it still treats personal names as durable view/assignment identifiers.

## Findings

### F-CPU-001 — person names are durable CPU routing authority

Severity: High
Confidence: Confirmed
Classification: A — role/proxy/routing/workflow authority

Evidence:

- `apps/cpu-production/lib/production-scope.ts:4,32-34` defines `ProductionRouting` as `liana | craig | site_manager` and converts those values into `sandwiches`, `hospitality`, and `delivered_in` scopes.
- `apps/cpu-production/lib/dashboard-views.ts:6-24,30-45` maps the dashboard's production/hospitality views back to `liana` and `craig`, while accepting `/craig` as a compatibility value.
- `apps/cpu-production/lib/cpu-routing.ts:5` returns the same person-derived enum from the Hub routing endpoint.
- `apps/integration-hub/lib/connections-service.ts:25,31-44,57,89,162` persists and validates `liana`/`craig`/`site_manager` in the `integrationHubHospitalityMenuProductionRouting` projection.
- `apps/integration-hub/lib/production-domain.ts:100` selects a line workstream from those names.
- `apps/integration-hub/app/api/connections/route.ts:28` validates the same values at the API boundary.
- `apps/integration-hub/app/ui/Connections.tsx:140,918,978,1097-1114` exposes the names as selectable routing views.

Impact: changing a person name or replacing a person changes which production work appears in a dashboard. This bypasses the intended AUTHMOD/Legend/staffing-role/OPLOC model and makes personnel change a data migration and authorization concern.

Required remediation (not performed in baseline): introduce stable non-person view/workstream identifiers, preserve existing menu-item IDs and routing history, map access through AUTHMOD permissions plus governed OPLOC/staffing-role assignments, and provide an explicit, audited compatibility migration for existing persisted routing documents. Do not silently reinterpret existing records.

### F-CPU-002 — person-specific implementation names leak into CPU route/component/CSS contracts

Severity: Medium
Confidence: Confirmed
Classification: B — person-derived naming/branding coupling

Evidence:

- `apps/cpu-production/app/ui/LianaOrderDetail.tsx` is the hospitality production detail implementation; its CSS classes and import are `liana-*` (`apps/cpu-production/app/ui/liana.css`, `apps/cpu-production/app/brand-overrides.css`, `apps/cpu-production/app/styles.css`).
- `apps/cpu-production/app/page.tsx` imports `LianaOrderDetail` for the general CPU dashboard.
- `apps/cpu-production/app/craig/page.tsx` is a compatibility alias to `/?view=hospitality`; `apps/cpu-production/app/hospitality-chef/page.tsx` documents that alias.
- CPU tests assert file names, route names, and `liana`/`craig` routing values (`apps/cpu-production/tests/cpu-production.test.ts`, `production-item-scope.test.ts`).

Impact: implementation naming communicates individual ownership and makes a role/workflow rename look like a personnel change. It does not by itself grant access, but it reinforces F-CPU-001 and creates a compatibility burden.

Required remediation (not performed in baseline): rename implementation contracts to neutral domain names such as `HospitalityProductionDetail` and `HospitalityProductionView`, retain redirects only for an explicitly time-bounded legacy period, and update tests without changing behavior.

### F-SOURCE-001 — “Brian” is source/provenance evidence, not access control

Severity: Low / accepted pending product naming decision
Confidence: Confirmed
Classification: C — source/provenance label

Evidence: `apps/menu-planning/scripts/import-brian-recipes.ts`, `apps/menu-planning/lib/recipe-importer.ts`, `apps/menu-planning/app/sources/recipe-import-panel.tsx`, `apps/menu-planning/fixtures/brian-recipe-candidates.json`, and related tests/docs label imported recipe evidence as Brian source material.

The code explicitly keeps these candidates unreviewed and does not use the label for authorization or routing. Preserve provenance/history; if the source is later renamed, add a stable source-provider/source-document identifier and retain the old label as historical evidence rather than rewriting records.

### F-CONFIG-001 — hardcoded personal/service email configuration exists outside AUTHMOD

Severity: Medium for operational maintainability; High where used as notification authority
Confidence: Confirmed
Classification: D — workspace/service configuration, with some personal routing

Evidence:

- `shared/cpu-dashboard/00_Config.js:56-57,92-93` contains named staff email/color entries used by the shared Calendar/dashboard configuration.
- `shared/client-feedback-portal/00_Config.js:48,61,67`, `01_SheetsService.js:22`, and `06_TestHarness.js:71,77` contain hardcoded notification recipients/default site mailboxes.
- `shared/cpu-dashboard/00_Config.js:43`, `01_Setup.js:91`, and `apps/integration-hub/lib/cpu-calendar-runner.ts:10` use `cpux@fikacatering.com` as the CPU Calendar resource identity.
- `apps/integration-hub/scripts/auth-cpu-calendar.ts` and `scripts/auth-gmail.ts` use fixed login hints for workspace resources.

The CPUX Calendar/service identity is intentionally operational and is consistent with AUTHMOD's separation of operational identities from people. It should move to governed environment/configuration, not be replaced by a personal account. Site mailbox recipients likewise need a governed notification configuration. Personal staff colors/labels should not be treated as permission data.

### F-FIXTURE-001 — person names in tests/spec fixtures are not runtime coupling

Severity: Low / accepted test and governance evidence
Confidence: Confirmed
Classification: E/F — synthetic fixture or historical governance record

Evidence includes `person:derek` in `fika-platform-specs/schemas/pack-2/fixtures`, `Derek`/`derek@example.test` in hospitality and Hub tests, synthetic identities in application tests, and explicit Derek/Sam decision records in `fika-platform-specs/docs/stages`.

These values are test actors or immutable decision provenance. They must not be bulk-renamed or deleted during a runtime refactor. Test identities should remain clearly synthetic; governance records should retain the historical decision maker.

### F-LOG-001 — logistics dashboard hardcodes a person as mutation actor and driver identity

Severity: High for audit attribution; Medium for driver assignment maintainability
Confidence: Confirmed
Classification: A/D — person-derived actor/audit authority and operational assignment configuration

Evidence:

- `apps/logistics/app/page.tsx:111,191,251,273,291,309,351,357,646-877,897,1499-1503,1575-1576,2016,2045-2289` repeatedly sends `by: "Franco"` for logistics mutations and defaults the driver selector to Franco, with Dee as the second hardcoded option.
- `apps/logistics/app/mobile/page.tsx:18,30,89` defaults the driver to Franco, offers Franco/Dee, and addresses a driver message to Franco.
- `apps/logistics/app/api/logistics/route.ts:698,716` seeds two vehicle slots with Franco and Dee; `:727-737` persists the selected display label and derives `driverId` by lowercasing that label.
- `apps/logistics/tests/planning.test.ts`, `planner-read-model.test.ts`, and `tests/e2e/*` encode Franco/Dee as operational identities.
- `apps/logistics/lib/auth.ts` correctly authenticates the current session through Hub AUTHMOD app access, but the mutation payload still carries a caller-supplied `by` string. The inspected path does not establish that this field is replaced server-side with the authenticated principal.

Impact: audit records can be attributed to Franco even when another authenticated operator performs the action, and driver assignment identity is coupled to mutable display names. This is distinct from authorization: AUTHMOD admission exists, but audit attribution and assignment identity are not yet canonical.

Required remediation (not performed in baseline): derive `by` from the authenticated AUTHMOD principal at the server boundary; use stable Legend/person identity IDs for driver assignment; resolve display labels from the governed read model; keep Franco/Dee only as historical fixture values or an explicit compatibility adapter. Do not migrate live assignments by guessing names or alter completed delivery history.

## Explicitly retained identities

The following are not classified as person-derived workflow authority:

- `cpux@fikacatering.com`: configured Calendar/service identity and AUTHMOD operational identity; retain as configuration evidence, move toward governed environment/config where appropriate.
- OPLOC/site mailbox addresses such as `seven@fikacatering.com`, `mnk@fikacatering.com`, and `isaias@fikacatering.com` when they identify a governed operational inbox or Calendar source; verify ownership/configuration rather than treating them as employee roles.
- `production_chef`, `head_chef_site_manager`, `integration-admin`, `reviewer`, and `viewer`: stable role/capability identifiers, not personal names.
- Brian-labelled recipe documents: source evidence, not authorization.
- Derek/Sam in dated platform specifications and test fixtures: historical governance/test identity, not runtime access logic.

## Cross-app impact map

The CPU routing defect crosses the HTTP boundary but does not require direct CPU-to-Hub imports. The safe target shape is:

`AUTHMOD session principal → permission/capability check → governed OPLOC/staffing-role or neutral production view → canonical Hospitality Menu Item ID → CPU projection`

The Integration Hub remains the owner of routing records; CPU should consume a typed HTTP projection. Existing canonical menu item IDs, production order IDs, and audit/history must remain stable. No client-side Firestore or additional broad Hub reads are justified by this finding.

## Remediation plan

1. Freeze a contract decision for neutral production views/workstreams and their relationship to AUTHMOD permissions, OPLOC scope, and staffing roles.
2. Add a versioned Hub migration/adapter for persisted `liana`/`craig` routing documents. Report unresolved mappings; do not guess from display names.
3. Change Hub API/schema/UI and CPU types to neutral identifiers, retaining a bounded read-only compatibility path for legacy records.
4. Rename CPU implementation/route/CSS contracts from person-derived names to domain names, preserving only explicitly documented redirects.
5. Move notification/calendar resource addresses to governed configuration where they are not immutable source identifiers; keep operational identities separate from people.
6. Add tests for legacy compatibility, unmapped routing, AUTHMOD denial, OPLOC scope, stable IDs, and no direct CPU→Hub imports.

## Audit status and limitations

This report records the frozen baseline and confirmed person-derived findings. No remediation has been applied. A complete formal audit still requires the protocol's separate app-by-app, shared, cross-app, auth, persistence, performance, test, environment, and legacy reports; those are not represented as complete by this baseline file. Runtime tests and builds were intentionally not run during the read-only baseline because this phase made no code changes and the worktree contains unrelated uncommitted changes.

No commit, push, deploy, destructive migration, persisted-data rewrite, or AUTHMOD change was performed.
