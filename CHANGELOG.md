# Changelog

This file records user-facing workflow changes delivered in the repository. Detailed architectural authority remains in `fika-platform-specs/`; this is the implementation history and UAT handoff record.

## Unreleased

### Canonical source control

- **2026-09-05 — README TL;DR:** added a concise repository and staging-policy summary to the root README. No reset or deployment performed.
- **2026-09-05 — README staging reset command:** documented the explicit hard-reset command, including its required planning-history flag and rebuild command. No reset or deployment performed.
- **2026-09-05 — THREAD 7A — preserve reusable Menu Planning history during normal staging reset:** normal staging reset now preserves all `fikaMenuPlanningWeeks` records for Duplicate Week, historic reference and realistic UAT source data. Complete planning-history deletion requires the separate `--hard-reset-planning-history` flag together with `--confirm-staging-reset`; no reset or deployment performed.
- **2026-09-05 — THREAD 7 — Week Planner Monday anchor, empty-week navigation and planning-history reset policy:** repaired Europe/London Monday anchoring and invalid query repair, enabled previous/next navigation across empty future weeks, kept duplicate-week targets as unpublished drafts with regenerated IDs, and changed staging reset handling for `fikaMenuPlanningWeeks` to preserve reusable draft/imported planning source while selectively removing published/superseded records. The existing `apps/menu-planning/scripts/import-rolling-menus.ts` workflow was identified, but its expected `C:\FIKA\Menu Data` sources were absent, so no historic import was executed. No deployment performed.
- **2026-09-05 — THREAD 6B — explicit staging rebuild command:** added guarded `npm run staging:rebuild`, which rebuilds the Menu Planning catalogue package from preserved canonical data and reports CPU/Delivered-In derived state as rebuilt only when valid source state exists, otherwise intentionally absent. It refuses local/emulator/non-staging runs, missing snapshot storage configuration, and non-empty unexplained operational sources. No reset or deployment performed.
- **2026-09-05 — THREAD 6A — staging reset safety correction:** separated preserved authoritative/audit data from operational UAT deletion, explicitly classified synthetic publication/event history as staging-resettable while preserving booking audit evidence, cleared CPU/Delivered-In/Menu Planning derived package prefixes by default, and required a successful explicit rebuild command before a destructive reset can complete. Dry run remains the default; no staging data or deployment performed.
- **2026-09-05 — THREAD 6 — live staging recovery and clean UAT baseline:** repaired Menu Planning withdrawal publication identity, added missing/stale catalogue package recovery with integrity fail-closed handling, recovered legacy CPU orders keyed by `requiredBy`, kept Delivered-In's operational week selector visible without published weeks, and added the guarded dry-run-first `npm run staging:reset` workflow for the explicit `fika-os-dev` staging project. Existing immutable publication amendment semantics were verified. Validation: focused Menu Planning, CPU, Delivered-In and Hub contract tests; affected-app typechecks and production builds passed. Live staging was not run because the documented local restore artifact was absent and the available Google credentials returned `invalid_rapt`; no staging reset or deployment performed.
- **2026-09-05 — THREAD 3/4 — Delivered-In blank-day navigation and Menu Planning withdrawal handoff:** kept published blank service days navigable and explicit, repaired invalid Delivered-In day selections, used Europe/London operational dates, and returned delivered/pending replay status after publication withdrawal. Affected areas: `apps/delivered-in`, `apps/menu-planning`. Validation: focused navigation, blank-day, redirect and route tests; typecheck/build validation pending. Deployment status: no deployment performed.
- **2026-09-05 — THREAD 1/2 — CPU package recovery and Hub package/Haleon integrity:** added coalesced CPU weekly package recovery for missing authoritative weeks, Europe/London CPU operational-date defaults, and coalesced Hub OPLOC, Service Arrangement and Service Definition package recovery while retaining fail-closed integrity handling. Added Haleon historical-to-current redirect coverage. Affected areas: `apps/cpu-production`, `apps/integration-hub`. Validation: source-level tests updated; local test/typecheck/build commands attempted but dependencies are not installed. Deployment status: no deployment performed.
- **2026-09-05 — agent operating-guide hardening:** updated root `AGENTS.md` with staging SHA provenance checks, exact-SHA deployment rules, package-state taxonomy (`hit`, `missing but rebuildable`, `stale`, `integrity failed`), historical package compatibility requirements, no-silent-stale fallback, cross-app contract ownership, minimum Menu Planning → CPU → Delivered-In UAT scenarios, treat-`main`-as-protected guidance, and usage-aware two-thread parallel limits. Affected areas: repository-wide agent workflow and FIKA OS readiness discipline. Validation: documentation review against current `main` workflow and existing nested `apps/delivered-in/AGENTS.md`. Deployment status: no deployment performed.
- **2026-09-04 — staging provenance audit:** compared canonical `main` (`2391bbc98b8feaa0dbc8befd8e581a3892e67f40`) with the six Firebase App Hosting staging backends. CPU and Menu Planning reported `7670408c2f228e60f6ac88bbe8571b35d4ee1434`; Delivered-In reported `37df1be5f620f723ea86a46abfbad92e5cba50ed`; the remaining backends did not expose a verifiable public build SHA. Exact-SHA staging rollouts are being submitted for the canonical commit. Deployment status: submitted, rollout completion not awaited.
- **2026-09-04 15:17 +01:00 — THREAD 0 — FIKA OS canonical workspace reset:** promoted the validated canonical history to `main`, rewrote the canonical platform README, and formalised the single-checkout/main-branch and mandatory changelog policies in `AGENTS.md`. Affected areas: repository documentation and source-control workflow. Validation: remote fast-forward verification, documentation review and `git diff --check`. Deployment status: no deployment performed.

### Architecture

- Repaired App Hosting build boundaries and replaced production sibling-app imports with explicit shared or HTTP contracts.
- Added recoverable top-level App Router error boundaries and refreshed staging friendly-domain configuration.

### Performance / Firestore

- Hardened Menu Planning, AUTHMOD and operational read paths with bounded queries, deterministic IDs and read-budget coverage.
- Added cache-manifest support for stable Integration Hub reference datasets.

### Authentication / Access

- Preserved server-side AUTHMOD admission, fail-closed errors, shared staging session cookies and request correlation across app boundaries.
- Added accessible confirmation flows for destructive Integration Hub actions.

### Logistics

- Restored dated staging UAT flows, side-effect-free projection reads, and fixed Van 1/Van 2 mobile routes.

### CPU Production

- Kept CPU routing and production workstream contracts behind the Integration Hub boundary.

### Hospitality

- Added inline booking validation and retained the real branded quote/build pipeline.

### Reliability / UX

- Improved error recovery, validation feedback and bounded refresh behaviour across the operational apps.

## 2026-08-22 — Targeted UAT repair pass

- Manager amendments now submit a strict client/service/order DTO, including edited quantities and items, while preserving rice-paper-roll minimum validation and quote staleness.
- Manager wording now uses “Produced by CPU — Yes / No”; the existing internal `deliveryChargeRequired` field remains compatible.
- Quote PDFs are rendered from the branded quote HTML through the local Chrome/Edge renderer, so layout and multi-page content are retained rather than flattened/truncated.
- Quote PDF Drive persistence is recorded against the immutable revision and gates CPU hand-off. Failed saves are audited and retryable without creating a new commercial revision; stored PDFs open directly where available.
- Active quote approval behaviour remains retired, with legacy `Approved` records retained only for compatibility and `Completed` still supported.
- Saved production-item IDs now include their parent menu scope, preventing same-title items in different menus from overwriting one another.

## 2026-08-22 — Hospitality, CPU and logistics UAT increment

### Booking and quoting

- Added the final “One last look” review step to booking portals, with persistent draft data across refreshes, readable dates/times and protection against accidental Enter-key submission.
- Kept “Who is booking for?” only for Angel Court; other portals no longer request it.
- Added booking context and delivery-charge selection to manager/CPU views.
- Enforced a minimum order of three boxes for rice paper rolls across booking and editing paths.
- Simplified the quote flow to manager review → generate/open quote → send to CPU, including stale-quote detection after edits and PDF/Drive storage through the existing integration.
- Removed redundant quote-approval friction and corrected quote pricing to use the current booking items, quantities and configured prices.

### Allergens, planning and menus

- Added persistent, overwrite-on-save allergen checker data for menu-specific sub-items across hospitality products, including explicit `MC` and notes handling.
- Added the supplied sandwich and hospitality allergen entries and made saved dropdowns unique to each menu item.
- Fixed stale allergen/planning refresh behaviour and immediate planned-state propagation between manager and CPU dashboards.
- Added readiness gating so menu generation is unavailable until menu items and allergen data exist.
- Added regeneration from scratch after allergen changes, corrected multi-item menu generation, improved menu layout, and omitted “No key allergens” text when none is present.
- Added Drive persistence and overwrite behaviour for signed allergen matrices.

### Production, dispatch and mobile driver workflow

- Connected approved/planned booking state to CPU production and menu availability.
- Added the driver-controlled dispatch action and removed the manager-only dispatch assumption.
- Fixed mobile driver route ordering so earliest stops appear first and displayed stop numbers follow that order.
- Added collection pairing six hours after a delivery when collection is required.
- Restored the logistics timeline’s horizontal/vertical zoom controls, aligned ruler indicators, simplified van rows and required a clear double click for inspection.
- Added drag-and-drop assignment between van timelines, including drops onto occupied cards; cards now move freely and snap only on release.
