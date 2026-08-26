# AUTHMOD permission matrix (Phase A)

The matrix maps observed capabilities to the controlled actions. It is a target classification for implementation; current auth values are noted only to show migration risk.

| Domain / capability | View | Contribute | Manage | Approve | Publish | Administer | Scope | Notes |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Integration Hub canonical read | yes |  |  |  |  |  | permitted data scope | Existing canonical.view is technical scaffold. |
| Integration Hub canonical editing/provider review |  | yes | yes |  |  |  | entity/domain | Separate technical administration from business approval. |
| AUTHMOD user/app/site/grant administration |  |  |  |  |  | yes | organisation | authmod.admin; not Full Access. |
| AUTHMOD import preview/reconciliation | yes | yes | yes |  |  | yes for commit | organisation | Upload/preview is not a grant commit. |
| CPU production queue/plan | yes | yes | yes |  |  |  | production/site | Route-specific classification to confirm in Phase E. |
| CPU production allergen sign | yes |  |  | yes |  |  | production/site and signatory role | Explicit authority may be held by a person or operational identity; the allergen record captures the human signatory evidence separately. |
| CPU final allergen approval | yes |  |  | yes |  |  | production/site and final role | Explicit authority may be held by a person or operational identity; distinct allergen-record signatory evidence remains required where two signatures are required. |
| Menu Planning rolling menu/catalogue/recipes | yes | yes | yes |  |  |  | menu/site as applicable | Existing routes are mixed; guard inventory required. |
| Menu Planning publication/withdrawal | yes |  |  |  | yes |  | organisation authority; normal site access still applies to the workflow | Separate menu.publish; Hub Admin does not imply it. |
| Logistics planning/jobs/assignment/loads | yes |  | yes |  |  |  | logistics domain/OPLOC | Do not classify every POST as Manage without route review. |
| Logistics dispatch/collection status | yes |  | yes |  |  |  | relevant movement/site | Explicit action mapping and actor from session. |
| Logistics repair/reconcile/reset/projection rebuild | yes |  |  |  |  | yes or dedicated reviewed authority | organisation/date scope | Privileged maintenance; exact actions still unresolved. |
| Hospitality internal bookings/quotes/menu operations | yes | yes | yes |  |  |  | OPLOC/client/domain | Public booking is excluded from human guards. |
| Delivered-In projection/site menu | yes |  |  |  |  |  | assigned OPLOC | Human app+site intersection. |
| Grab & Go operational edit/submit | yes | yes | yes |  |  |  | assigned OPLOC | View-only users cannot POST. |
| Ad-Hoc request authoring/management | yes | yes | yes |  |  |  | request destination/domain | Replace synthetic Hub role checks. |
| Service CPU projection read |  |  |  |  |  |  | service/OPLOC if relevant | Service principal only; no human CPU grant required. |

## Application access versus authority

Application grants determine which app can be entered. Action grants determine what may be done inside it. OPLOC assignments determine where the action may apply. A Full Access user receives normal app/site access only; they still need menu.publish, allergen authority or authmod.admin explicitly.

## Observed migration hazards

- Integration Hub integration-admin, reviewer, viewer are synthetic technical roles and currently drive business permissions.
- Menu Planning currently uses Hub roles for mutation/publication, with a local development fallback.
- CPU allergen command parsing accepts a client-supplied role; the target must derive signatory authority from AUTHMOD.
- Logistics uses client body.by and a human default.
- Delivered-In already checks canonical OPLOC access but resolves it from synthetic user fixtures.
- Several Menu Planning, CPU, Hospitality and Delivered-In routes have no visible shared human guard in the route source and require classification before enforcement.
