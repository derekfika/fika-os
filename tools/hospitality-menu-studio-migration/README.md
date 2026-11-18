# Hospitality Menu Studio rotation dry run

This offline planner checks an explicitly supplied legacy Rotations snapshot and reports what can be preserved as history, proposed as an inactive Studio draft or referenced from Menu Planning. It checks export consistency and identity. It does not capture data, write files, create import payloads, call Firebase or authorise cutover. Use synthetic data for development. Any real export requires separate authority and must be handled as internal business evidence.

With the repository's dependencies installed, run on Node.js 22.18 or later.

```powershell
npm ci --ignore-scripts
node tools/hospitality-menu-studio-migration/dry-run.mjs path/to/export.json
node --test tools/hospitality-menu-studio-migration/plan.test.mjs
```

The planner writes a JSON report to stdout. A reviewable report exits `0` with `REVIEW_REQUIRED`. Conflicting evidence exits `2` with `BLOCKED`. Unreadable or invalid exports exit `65`. Invalid arguments exit `64`. Every report is non-activatable. No CLI flag enables migration.

## Input snapshot

Supply a single UTF-8 JSON file up to 256 MiB. Include the following fields using the exact stored document IDs and records. Arrays of source documents contain entries of the shape `{ "id": "stored-document-id", "data": { ... } }`. Supply empty arrays for deliberately empty collections.

| Field | Source |
| --- | --- |
| `schema` | `hospitality-rotations-export.v1` |
| `projectId`, `capturedAt` | Source Firebase project ID and UTC ISO instant of the consistent export. The capture instant determines the London inventory date. Project ID is supplied provenance, not an authenticated runtime identity. |
| `head` | Raw `integrationHubHospitalityRotationsV1/company` document, or `null` only if absent. |
| `revisions` | Every raw `revisions` document under the company, including drafts, published recipes, and the persisted `evidenceHash`. Public HTTP responses omit this checksum and cannot substitute for the export. |
| `dishLinks`, `dishLinksByDish` | Both raw link subcollections under the company, including link evidence fields. |
| `dishes` | Raw `fikaMenuPlanningCatalogue` documents for Hospitality-scoped or explicitly shared dishes, including unlinked dishes and any IDs referenced by the exported legacy records. |
| `items` | Raw `integrationHubCanonical` Hospitality Menu Item documents for referenced Item IDs, including archived or withdrawn records. |
| `destinationBindings` (optional) | Explicitly captured destination lineage entries of the form `{ "dishId": "...", "recipeRevision": 1, "sourceHash": "sha256" }`. Omission leaves destination conflicts unchecked. Use `[]` only if the destination inventory established that it is empty. |

The separate cutover inventory preserves command receipts and compares current AUTHMOD, Item redirects and commercial eligibility, booking compatibility and actual destination records. A consistent export must be established and rechecked by its authorised owner. The planner checks its internal evidence and cannot prove source completeness beyond the supplied manifest and references.

## Evidence and limits

The report preserves legacy activation dates, revision and source-draft IDs, original anchor and week order, group/Item IDs, link IDs and rule fingerprints. Dish candidates carry stable ID, source revision and hash. Incomplete legacy drafts remain recognisable. A non-six-week live cohort is a blocker and historical calendars stay identifiable. A shared record remains under Menu Planning authority. Current or future activation requires explicit mapping, customer and kitchen descriptions, dietary and hot/cold classification, fixed assortment review where applicable and verified current CPU evidence. Frozen allergen facts or existing order signatures cannot be promoted by migration.

Use the plan hash to compare repeated reports from the same snapshot. Source revision hashes bind the original records, while the plan hash identifies the report contents. Archive the protected export separately for historical rehydration. Report details omit recipe text, actor data and signatures.
