# THREAD 10 — Read-only FIKA OS UI compliance audit

Audit date: 2026-09-05  
Repository: `C:\FIKA`  
Baseline `origin/main`: `2f1fcc088d58511c25dbf45b27690fabc23be52d`  
Branch: `main`  
Working tree: pre-existing unstaged `docs/STYLE-GUIDE.md`; no application files were changed.

This is a static, evidence-led UI compliance audit against `docs/STYLE-GUIDE.md`. It is not a visual redesign, runtime accessibility certification or general codebase audit. Raw colour counts include legitimate print/client-brand exceptions; only the findings below are classified as violations.

## Executive summary

The launch apps are usable and several have already adopted the intended light FIKA visual language, semantic status text and progress patterns. Compliance is not uniform. Integration Hub has a production `window.prompt()` in the authorised Booking workflow. Delivered-In has no app-level `:focus-visible` rule and uses Arial/local raw tokens rather than the shared foundation. CPU Production, Menu Planning and Hospitality use local parallel token systems with extensive raw colours; this is mostly P2 design-system drift rather than an immediate readability failure. Hospitality customer portals are intentionally client-branded and are not counted as FIKA operational-chrome violations without separating the surface.

## Severity counts

| Severity | Count | Meaning |
| --- | ---: | --- |
| P1 | 2 | Must fix before launch |
| P2 | 9 | Should fix before launch if low risk |
| P3 | 2 | Post-launch polish |

## Findings

### UI-001 — Native prompt used for Booking status reason

**Severity:** P1  
**Confidence:** High  
**Category:** Native browser dialogs; Modals; Accessibility

**Evidence:** `apps/integration-hub/app/ui/HospitalityBookings.tsx:10` calls `window.prompt(...)` before changing a canonical Booking status.

**Observed behaviour:** The user is asked for a status reason using browser-native UI. The workflow has no application title, affected Booking context, FIKA button hierarchy, focus management or accessible recovery path.

**Style Guide rule:** Native browser dialogs are prohibited in normal user-facing workflows. Confirmation/reason dialogs must use the FIKA modal standard with semantic actions and focus management.

**Impact:** High-risk operational Booking changes can be cancelled or misunderstood without the surrounding workflow context.

**Recommended remediation:** Replace the prompt with a standard controlled reason modal containing the Booking identity, status transition, required reason field, Cancel and Confirm actions, Escape safety and focus return.

**Regression test:** Assert the Booking workflow renders the application reason dialog and contains no native prompt call.

### UI-002 — Delivered-In has no visible focus rule

**Severity:** P1  
**Confidence:** High  
**Category:** Accessibility; Buttons and controls

**Evidence:** `apps/delivered-in/app/layout.tsx:1-3` imports only the Delivered-In styles; `apps/delivered-in/app/styles.css:1` contains the app-wide controls and no `:focus-visible` rule. Static scan found zero `:focus-visible` occurrences under `apps/delivered-in/app`.

**Observed behaviour:** Keyboard users have no guaranteed visible focus indicator for site selection, week/day navigation, menu generation or safety acknowledgement controls.

**Style Guide rule:** Every interactive control needs visible `:focus-visible` styling and every interactive workflow must be keyboard navigable.

**Impact:** Critical site/menu and allergen workflows are difficult or impossible to operate reliably by keyboard.

**Recommended remediation:** Add a shared-token focus rule to the Delivered-In operational surface and verify focus visibility on header navigation, selectors, links, modal/safety actions and generated-menu actions.

**Regression test:** Add a focused style contract/static test for the app-level focus rule and keyboard tab coverage for the critical controls.

### UI-003 — Launch apps use parallel local colour systems instead of shared semantic tokens

**Severity:** P2  
**Confidence:** High  
**Category:** Hard-coded colours; Colour/contrast; Token adoption

**Evidence:** `shared/fika/tokens.css` is the authoritative semantic foundation. Integration Hub and CPU import local `fika-tokens.css`; Logistics imports the shared file from `apps/logistics/app/styles.css:1`; Menu Planning defines local aliases in `apps/menu-planning/app/styles.css:1`; Delivered-In defines local aliases in `apps/delivered-in/app/styles.css:1`; Hospitality defines a separate local system in `apps/hospitality-booking/app/globals.css:1`.

**Observed behaviour:** The same operational concepts use different names and raw values (`--mint`, `--cyan`, `--deep`, `--purple`) across apps. Raw colour scans found 538, 520, 917, 206, 594 and 395 matches respectively in the six app `app` trees; this includes approved print/client-brand output and is not itself a count of defects.

**Style Guide rule:** New or materially changed user-facing components must use shared semantic FIKA tokens where an equivalent exists; do not introduce one-off colour systems.

**Impact:** Future UI changes can drift in contrast, action hierarchy and status meaning between apps.

**Recommended remediation:** Migrate touched operational surfaces incrementally to `--fika-*` aliases. Keep print-safe generated documents and explicitly client-branded portal surfaces documented as exceptions.

### UI-004 — Integration Hub primary action uses turquoise instead of purple

**Severity:** P2  
**Confidence:** High  
**Category:** Buttons; Colour/contrast

**Evidence:** `apps/integration-hub/app/globals.css:6` defines `.primary` with `background:var(--color-brand-turquoise)` and dark text.

**Observed behaviour:** The shared-looking primary button is visually a turquoise action rather than the FIKA purple primary action.

**Style Guide rule:** Primary buttons use purple with white text; turquoise is an accent or pale surface, not the default primary action.

**Impact:** Primary action hierarchy is inconsistent with Menu Planning and the authoritative button standard.

**Recommended remediation:** Change the operational primary variant to the shared purple action token and retain turquoise only for accent/success treatment where semantically appropriate.

### UI-005 — CPU Production operational UI uses Arial instead of Gilroy

**Severity:** P2  
**Confidence:** High  
**Category:** Typography; Token adoption

**Evidence:** `apps/cpu-production/app/layout.tsx:2-4` imports local tokens, while `apps/cpu-production/app/styles.css:1` sets `font-family:Arial,sans-serif` on `body` despite the local token file defining the Gilroy family.

**Observed behaviour:** The CPU operational screen does not use the working interface face required by the guide.

**Style Guide rule:** Gilroy is the working interface face for navigation, labels, controls, body copy and operational data.

**Recommended remediation:** Use the existing Gilroy body token for CPU operational UI; preserve any explicitly justified document/print font exceptions.

### UI-006 — Delivered-In operational UI uses Arial and local raw status values

**Severity:** P2  
**Confidence:** High  
**Category:** Typography; Hard-coded colours; Token adoption

**Evidence:** `apps/delivered-in/app/styles.css:1` sets `font-family:Arial,sans-serif` and defines local `--purple`, `--success`, `--danger` values instead of importing the shared foundation.

**Observed behaviour:** The app visually diverges from the working FIKA interface face and semantic token vocabulary.

**Style Guide rule:** Use Gilroy for operational UI and shared semantic tokens for new/touched surfaces.

**Recommended remediation:** Alias the Delivered-In operational styles to the shared foundation, then replace raw/local status colours as each active surface is touched.

### UI-007 — Delivered-In and Integration Hub modal families are not consistently governed

**Severity:** P2  
**Confidence:** Medium  
**Category:** Modals; Accessibility

**Evidence:** `apps/integration-hub/app/ui/ConfirmationModal.tsx:1-17` correctly implements initial focus, Escape safety and focus return. Other active modal paths, including `apps/menu-planning/app/rolling-menu-workspace.tsx:190-259` and Delivered-In’s safety modal in `apps/delivered-in/app/allergen-safety-notice.tsx:16-20`, expose dialog roles but do not show the same consistent focus-return/focus-trap pattern in the audited source.

**Observed behaviour:** Modal semantics and safety behaviour vary by workflow. Some modals close on backdrop or expose only a role/name without a consistent close/focus contract.

**Style Guide rule:** Every modal must manage focus, return focus, support Escape when safe, use a visible close/cancel path and prevent unsafe dismissal.

**Recommended remediation:** Extract or standardise a shared dialog primitive, then audit destructive, safety and committed-write dialogs first. Do not make the allergen safety blocker dismissible while the safety state is unresolved.

### UI-008 — Long-running progress is uneven outside the reference importer

**Severity:** P2  
**Confidence:** Medium  
**Category:** Long-running operations; Loading/error states

**Evidence:** Menu Planning’s importer contains detailed checking/import progress in `apps/menu-planning/app/import-menu-week/page.tsx`. Hospitality Dashboard has a staged amendment progress modal in `apps/hospitality-booking/app/ui/HospitalityDashboard.tsx:1159-1200`. In contrast, Delivered-In’s `SiteMenuControls` in `apps/delivered-in/app/page.tsx:11` presents only `Working…`, and CPU command paths generally present `Saving…`/`Syncing…` without a stage/count model.

**Observed behaviour:** Some operational writes provide no current item, completed count or progress bar when the operation can involve downstream work.

**Style Guide rule:** Long-running operations must show meaningful stage/current item/count progress, prevent duplicate submission and provide clear success/failure states in plain language.

**Recommended remediation:** Apply the existing importer/amendment pattern selectively to Delivered-In generation, CPU release/signature workflows and any multi-step Logistics command; keep instant writes local and restrained.

### UI-009 — Several modal surfaces allow backdrop dismissal without an explicit safety assessment

**Severity:** P2  
**Confidence:** Medium  
**Category:** Modals; Unsafe dismissal

**Evidence:** `apps/menu-planning/app/week-planner.tsx:33-50` closes input/duplicate/reset dialogs on backdrop mouse-down; `apps/menu-planning/app/rolling-menu-workspace.tsx:190-206` uses modal backdrops with explicit close controls; `apps/logistics/app/mobile/MobileWorkflow.tsx:127-130` closes detail sheets from backdrop interaction.

**Observed behaviour:** The source shows backdrop dismissal in workflows that can contain unsaved planning, reset or operational decisions. The reset dialog has a confirmation checkbox, but the dismissal policy is not consistently expressed by a shared rule.

**Style Guide rule:** Unsafe committed writes must not be dismissible accidentally; Escape is allowed only when safe and modal close behaviour must be explicit.

**Recommended remediation:** Classify each dialog as safe-to-dismiss or committed/unsafe; disable backdrop/Escape dismissal during unsafe states and add unsaved-change protection where needed.

### UI-010 — Operational UI contains raw hard-coded colours in active components where tokens exist

**Severity:** P2  
**Confidence:** High  
**Category:** Hard-coded colours

**Evidence:** Examples include `apps/menu-planning/app/styles.css:1-5`, `apps/cpu-production/app/styles.css:1-2`, `apps/delivered-in/app/styles.css:1`, `apps/logistics/app/page.tsx:101` and `apps/hospitality-booking/app/ui/HospitalityDashboard.module.css:52-85`.

**Observed behaviour:** Active screens use literal hex/RGB values for surfaces, borders, focus-like shadows, statuses and action colours despite equivalent semantic tokens.

**Style Guide rule:** New or materially changed user-facing components must use shared semantic tokens; raw values require a documented exception.

**Recommended remediation:** Treat this as a migration queue, not a mass restyle. Convert only files touched by feature work, and document print/client-brand exceptions.

### UI-011 — Hospitality operational dashboard and customer portals need an explicit surface boundary

**Severity:** P2  
**Confidence:** Medium  
**Category:** Client-branded exceptions; Token adoption

**Evidence:** `apps/hospitality-booking/app/globals.css:11-16` defines Angel Court, CFC and Munich Re palettes/fonts, while `apps/hospitality-booking/app/ui/HospitalityDashboard.module.css:360-680` contains dashboard/document styling with client-like and raw colour values.

**Observed behaviour:** The codebase contains legitimate client-branded portal variants beside FIKA operational dashboard styles, but the boundary is not mechanically obvious from the stylesheet structure.

**Style Guide rule:** Client-branded customer surfaces may use client palettes/fonts; FIKA OS operational chrome must still use the shared standard and enforce accessibility.

**Recommended remediation:** Keep client portal overrides scoped and documented; isolate the internal dashboard token layer so future audits do not mistake customer branding for operational chrome.

### UI-012 — Operational shell dimensions show legacy drift but no launch-blocking evidence

**Severity:** P3  
**Confidence:** High  
**Category:** Sidebar/shell; Page headers; Responsive behaviour

**Evidence:** The active apps use different shell/header patterns: Hospitality’s top bar is 72px in `apps/hospitality-booking/app/globals.css:1`, Menu Planning’s header is 82px in `apps/menu-planning/app/styles.css:1`, and Delivered-In uses a different header/nav structure in `apps/delivered-in/app/styles.css:1`.

**Observed behaviour:** The 84px/190px/1200px targets are not uniformly implemented.

**Style Guide rule:** These are target standards for new/touched UI, not a migration mandate unless the difference causes readability, accessibility or broken interaction.

**Recommended remediation:** Defer broad shell migration. Align dimensions when each app is next materially touched; verify narrow-screen overflow at that time.

### UI-013 — Empty/loading/error treatment is strong in core projections but inconsistent in command surfaces

**Severity:** P3  
**Confidence:** Medium  
**Category:** Empty/loading/error states

**Evidence:** Delivered-In distinguishes no published data, intentionally blank service days and unavailable projections in `apps/delivered-in/app/page.tsx:11`. Integration Hub and Hospitality also expose `role="alert"`/`role="status"` in active flows. Some CPU and Logistics command surfaces use terse busy labels without equivalent contextual completion/error treatment.

**Observed behaviour:** Read/projection screens are comparatively clear; mutation-heavy screens vary in how much context they retain after completion or failure.

**Style Guide rule:** Differentiate no data, intentional blank, loading, unavailable, withdrawn and error; errors should explain recovery.

**Recommended remediation:** Standardise command result messaging after P1/P2 modal/progress work; do not change already-correct blank-day semantics.

## Native dialog scan

### In-scope production violation

| File | Component/workflow | Call | Severity | Replacement |
| --- | --- | --- | --- | --- |
| `apps/integration-hub/app/ui/HospitalityBookings.tsx:10` | Canonical Booking status change | `window.prompt(...)` | P1 | FIKA reason modal with labelled textarea, status transition, Cancel/Confirm and focus management |

Out-of-scope/legacy observations, not counted in the launch scorecard: `apps/events-dashboard/app/ui/Dashboard.tsx:140,149` is explicitly out of scope for this wave; `shared/cpu-dashboard/Script.html:1104` and `shared/workforce-operations-platform/Script.html:1023` are legacy standalone tools and should be re-audited only if confirmed user-facing launch routes.

## Token adoption and scorecard

| App | Token adoption | Typography | Colour/contrast | Buttons | Modals | Native dialogs | Accessibility | Density | Overall | Launch risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Integration Hub | Partially aligned: local token file, not shared foundation | GOOD: Gilroy local family | NEEDS CLEANUP: turquoise primary/raw values | NEEDS CLEANUP | MINOR DRIFT | HIGH PRIORITY | NEEDS CLEANUP | GOOD | NEEDS CLEANUP | High |
| Menu Planning | Partially aligned: strong local aliases, no shared import | GOOD: Gilroy usage | MINOR DRIFT: local/raw values | GOOD in touched importer; older variants remain | MINOR DRIFT | GOOD | GOOD in touched flows; modal consistency remains | GOOD | GOOD / minor drift | Medium |
| CPU Production | Partially aligned: local token file | NEEDS CLEANUP: Arial body | NEEDS CLEANUP: extensive raw values | MINOR DRIFT | MINOR DRIFT | GOOD | MINOR DRIFT | GOOD | NEEDS CLEANUP | Medium |
| Delivered-In | Structurally divergent: no shared import | NEEDS CLEANUP: Arial body | NEEDS CLEANUP: local/raw values | MINOR DRIFT | NEEDS CLEANUP | GOOD | HIGH PRIORITY: no focus-visible rule | GOOD | HIGH PRIORITY | High |
| Logistics | Aligned foundation import; app-specific usage remains | GOOD: shared/local Gilroy assets | MINOR DRIFT | MINOR DRIFT | MINOR DRIFT | GOOD | MINOR DRIFT | GOOD | MINOR DRIFT | Medium |
| Hospitality | Partially aligned: separate portal/dashboard system | GOOD in portal/dashboard, client exceptions intentional | MINOR DRIFT outside client exception | MINOR DRIFT | GOOD progress pattern; standardisation needed | GOOD | MINOR DRIFT | GOOD | MINOR DRIFT | Medium |

## Coverage by Style Guide category

| Category | Result |
| --- | --- |
| Typography | Findings: UI-005, UI-006, UI-011 |
| Colour / contrast | Findings: UI-003, UI-004, UI-006, UI-010, UI-011 |
| Hard-coded colours | Findings: UI-003, UI-010; legitimate print/client exceptions separated |
| Buttons | Findings: UI-004; inspected other primary/secondary/loading patterns |
| Inputs | Inspected — labelled controls are common; no single launch-blocking pattern established by static scan |
| Cards | Inspected — light cards and restrained borders are the dominant active pattern |
| Tables / lists | Inspected — bounded/scrolling tables and compact operational lists present; no P1 finding |
| Modals | Findings: UI-001, UI-007, UI-009 |
| Sidebar / shell | Finding: UI-012 |
| Page headers | Finding: UI-012; no P1 |
| Status / alerts | Findings: UI-003, UI-013; status text is generally paired with words |
| Empty / loading / error states | Finding: UI-013 |
| Accessibility | Findings: UI-001, UI-002, UI-007, UI-009 |
| Responsive behaviour | Inspected — active apps contain narrow-screen rules; modal/shell verification should be included with remediation |
| Density | Inspected — Menu Planning importer and Logistics operational lists are compact; no P1 |
| Long-running operations | Finding: UI-008 |
| Bulk actions | Menu Planning importer inspected and aligned with the reference pattern; no new finding |
| Native browser dialogs | Finding: UI-001 |

## TOP 10 PRE-LAUNCH UI FIXES

1. **P1 · Integration Hub · `HospitalityBookings.tsx:10` · Native browser dialogs:** replace `window.prompt` with a governed reason modal. **Risk: LOW.**
2. **P1 · Delivered-In · `app/styles.css:1` · Accessibility/focus:** add visible shared-token focus styling and keyboard-verify critical controls. **Risk: LOW.**
3. **P2 · Integration Hub · `globals.css:6` · Buttons:** change the generic primary button from turquoise to purple/white. **Risk: LOW.**
4. **P2 · Delivered-In · `layout.tsx`/`styles.css` · Typography/tokens:** adopt shared semantic aliases and Gilroy for operational UI. **Risk: MEDIUM.**
5. **P2 · CPU Production · `styles.css:1` · Typography:** use Gilroy body token instead of Arial. **Risk: LOW.**
6. **P2 · All active apps · local token files · Hard-coded colours:** convert touched operational styles to shared semantic tokens; record print/client exceptions. **Risk: MEDIUM.**
7. **P2 · Menu Planning/Delivered-In/Logistics · modal components · Modal safety:** standardise focus return, Escape and backdrop dismissal rules. **Risk: MEDIUM.**
8. **P2 · Delivered-In/CPU · command actions · Long-running operations:** add stage/count/current-item progress where downstream work is non-instant. **Risk: MEDIUM.**
9. **P2 · Hospitality · dashboard vs portal styles · Client boundary:** isolate/document client-brand overrides from FIKA operational chrome. **Risk: MEDIUM.**
10. **P2 · Active app shells · shell styles · Responsive/density:** verify the highest-use narrow layouts and align dimensions opportunistically, not as a mass restyle. **Risk: MEDIUM.**

## Low-risk fixes suitable today

- Replace the Integration Hub native prompt with the existing modal pattern.
- Add Delivered-In `:focus-visible` styling using the shared focus token.
- Change Integration Hub’s generic primary action to purple/white.
- Change CPU’s operational body font to the existing Gilroy token.

## Post-launch polish

- Incremental local-token/raw-colour migration.
- Shared shell dimension convergence.
- Further modal primitive consolidation.
- Clearer command completion/error copy where the action is already safe and correct.

## Validation performed

- `cd C:\FIKA`
- `git fetch origin`
- Recorded `origin/main`: `2f1fcc088d58511c25dbf45b27690fabc23be52d`
- Read `AGENTS.md`, `docs/STYLE-GUIDE.md`, `docs/ai/CODEBASE-AUDIT-PROTOCOL.md` and `docs/ai/LOGGING-AUDIT-STRATEGY.md`.
- Static native-dialog scan over in-scope production app code, excluding tests/tools and out-of-scope apps.
- Static token, font, focus, raw-colour, modal and progress scans over the six in-scope app trees.
- No application code, CSS, tests, configuration, runtime data or deployment state changed.
- No builds/typechecks/E2E were run; this was a read-only static UI audit.

## Conclusion

**Style Guide coverage: GAPS FOUND.** The launch candidate is not fully compliant. The two P1 findings should be remediated before launch; the P2 list is a focused, incremental remediation queue rather than a mandate for a cross-app restyle.

**TL;DR:** Integration Hub still uses a native Booking reason prompt, and Delivered-In lacks visible keyboard focus styling. Token/font adoption is uneven, but the Menu Planning importer, Logistics foundation and several progress/status patterns are aligned. No application changes or deployment were performed.
