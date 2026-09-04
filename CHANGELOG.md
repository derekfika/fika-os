# Changelog

This file records user-facing workflow changes delivered in the repository. Detailed architectural authority remains in `fika-platform-specs/`; this is the implementation history and UAT handoff record.

## Unreleased

### Canonical source control

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

### Verification

- Logistics typecheck passes; all 27 logistics tests pass.
- Hospitality typecheck and test suite pass (30 tests).
- CPU typecheck passes; the suite has one known legacy saved-allergen fixture failure requiring fixture reconciliation.
