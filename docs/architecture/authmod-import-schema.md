# AUTHMOD spreadsheet import schema (Phase A)

The spreadsheet is a bootstrap and optional bulk-edit source. It is never read by application authorization at runtime. The import is always two-phase: upload/parse and preview/reconciliation, then an explicit administrator commit.

## Recommended workbook

Use one primary sheet named Access and preserve the original file name, SHA-256 hash and upload metadata in ImportRecord. The importer should accept CSV/XLSX, normalize headers case-insensitively, and report unknown or duplicate columns instead of silently dropping them.

| Column | Type | Required | Meaning |
|---|---|---:|---|
| Email | string | yes | Workspace email matching attribute; not immutable identity |
| Full Name | string | no | Display/matching hint only |
| External UID | string | no | Provider UID when supplied; strongest identity match |
| Legend ID | string | no | Canonical Legend ID; explicit reviewed link |
| Legend | string | no | Display hint only; never identity by itself |
| Active | boolean | yes | Proposed employment/access status; accepted values are true/false, yes/no, 1/0 |
| Full Access | boolean | no | Normal launch-critical apps and normal OPLOC scope only |
| AUTHMOD Admin | boolean | no | Explicit authmod.admin grant; independent from Full Access |
| Menu Publish | boolean | no | Explicit menu.publish grant |
| Production Allergen Sign | boolean | no | Explicit production sign authority |
| Final Allergen Sign | boolean | no | Explicit final approval authority |
| Logistics Repair | boolean | no | Proposed only if approved in the final route/action catalogue |
| Logistics Reconcile | boolean | no | Proposed only if approved in the final route/action catalogue |
| Logistics Reset | boolean | no | Proposed only if approved in the final route/action catalogue |

## Dynamic site and application columns

Site columns are generated from the canonical active OPLOC registry at import-template time. A column uses a stable machine header and a human label, for example site:oploc:mnk with display label MNK. Human labels are not record identity. The importer must show missing, renamed, archived or unknown site columns as reconciliation issues.

Application columns use stable headers:

- app:integration-hub
- app:cpu-production
- app:logistics
- app:menu-planning
- app:hospitality-booking
- app:delivered-in
- app:ad-hoc-production

Do not include Events Dashboard or Beverage Innovation in the v1 template. A future scope:stable-app-id extension may express unusual app-specific scope, but v1 uses app access plus OPLOC assignments.

## Boolean normalization

Accepted true values: true, yes, y, 1, x, checked. Accepted false values: false, no, n, 0, blank, unchecked. Any other value is an error requiring correction. Empty optional fields mean no proposal; they do not mean revoke unless the import mode explicitly says replace and the administrator confirms the replacement scope.

## Import modes

- propose: report additions/changes only; safest default.
- merge: apply explicitly populated cells while preserving grants not represented by the file.
- replace-scoped: replace the declared app/site/authority sections only after a prominent confirmation; never replace unrelated records.

The first import should use propose or a reviewed merge, not a destructive replacement.

## Preview and reconciliation report

The preview response should include:

- rows found, valid/invalid rows and duplicate email/UID counts;
- matched Legends, possible matches with confidence/reason, and unmatched identities;
- new AuthIdentity candidates;
- proposed activations/deactivations;
- proposed site/app/authority additions, removals and unchanged grants;
- unknown/archived OPLOC columns and unknown special-authority columns;
- rows blocked from commit and the reason;
- source hash, parser version and deterministic preview ID.

Example summary: 150 Workspace users found; 137 matched; 9 possible matches; 4 unmatched; 4 new users; 7 permission changes; 2 proposed deactivations; 3 unresolved mappings.

## Matching rules

1. Exact external UID to existing AuthIdentity.
2. Exact normalized email to existing external identity where the provider confirms it.
3. Explicit Legend ID to canonical Legend, with conflict detection.
4. Name/email suggestions only, shown as possible matches and never auto-committed.

Conflicts, duplicate emails, terminated Legend records, and low-confidence matches require an AUTHMOD Admin resolution. A row with no resolved identity can create a NO ACCESS candidate but cannot create an access grant.

## Commit and audit

Commit requires a fresh preview ID, authenticated AUTHMOD Admin, selected row decisions, and an idempotency key. The server rechecks current versions before writing. It creates/updates AuthIdentity and grants, leaves unresolved rows visible, and appends an AccessAuditEvent per meaningful target change plus an ImportRecord commit summary. The actor is taken from the authenticated session, not from workbook columns.
