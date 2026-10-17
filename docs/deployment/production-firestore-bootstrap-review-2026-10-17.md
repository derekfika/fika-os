# Production Firestore bootstrap review — 2026-10-17

## Fresh snapshot

- Source project: `fika-os-dev`; destination: `fika-os`.
- Recursive inventory captured `2026-10-17T13:29:04.029Z` UTC by read-only Firestore REST `listCollectionIds` and paginated `listDocuments` calls.
- Source: **12,543 documents / 203 collection paths**. Destination: **0 documents / 0 collection paths**.
- Candidate: **2,259 retained / 10,284 excluded**. `invariantProblems: []` for the plan's exact-path uniqueness, action-count reconciliation and empty-target checks.
- `planHash`: `8d2828dd8caa44a68f1407f3cacb56f196f8fa41ee80595882cb1d906f8bf4ed`.
- `sourceHash`: `540c82957588c256d7625905961656402bc0704294c5f99f87f02f221b331256`.
- Full exact document-path action list and source/target hashes are in the local dry-run plan at `%TEMP%\fika-firestore-bootstrap-plan.json`. It contains no document field bodies and is not committed. Rebuild it with `node tools/firestore-bootstrap/cli.mjs`; a source or destination change produces a different hash.
- No database was written. Copier apply was not run.

## Retention and exclusion plan

| Retained collection | Documents |
| --- | ---: |
| `integrationHubCanonical` | 1,077 |
| `integrationHubCanonicalRevisions` | 610 |
| `integrationHubHospitalityMenuItemMerges` | 42 |
| `integrationHubHospitalityMenuProductionRouting` | 52 |
| `integrationHubHospitalityCatalogueReviewDecisions` | 6 |
| `integrationHubSourceMappings` | 41 |
| `fikaMenuPlanningCatalogue` | 404 |
| `fikaMenuPlanningCatalogueManifests` | 1 |
| `authmodApplications` | 7 |
| `authmodIdentities` | 19 |
| **Total retained** | **2,259** |

The Hub canonical snapshot includes 90 Hospitality Menu Items, 140 published Hospitality Menu Offerings, 82 Hospitality Menu Prices and 24 OPLOCs. The 610 immutable canonical revisions include 243 Offering revisions. The latest Menu Planning catalogue source hash matches its current Firestore catalogue head. All canonical entities/revisions are retained in this candidate so stable references and actor lineage remain resolvable.

| Exclusion group | Documents | Treatment |
| --- | ---: | --- |
| AUTHMOD staging grants, assignments, access audit/heads and import state | 339 | Do not copy staging authorization. Recreate production access through Hub administration. |
| Hospitality booking history | 287 | Exclude bookings, booking groups/quotes, notifications and booking audit. |
| Menu Planning weeks, publications, events, outbox and Drive archive pointers | 2,442 | Exclude operational history; this includes six `fikaMenuPlanningArchiveMetadata` Drive pointers. |
| Delivered-In projections, site menus, releases, receipts and Grab & Go operational state | 270 | Exclude downstream operational history. |
| CPU state, projections, releases, packages, feeds, receipts and outboxes | 3,436 | Exclude all UAT CPU operational and derived state. |
| Logistics state, movements, projections, feeds and outboxes | 1,362 | Exclude all UAT Logistics operational and derived state. |
| Production Orders, Production Requirements, Fulfilment Requirements and domain events/inbox | 1,159 | Exclude derived cross-domain operational closure. |
| Staging governance audit | 985 | Keep source-side. Do not recast staging audit entries as production history. Canonical revisions remain retained. |
| Environment-specific settings, cleanup receipt and rebuildable cache manifest | 4 | Exclude staging Drive folder settings and transient metadata. |
| **Total excluded** | **10,284** | |

## Safety, identity and lineage findings

- `fikaCpuAllergenCompositionAuthoritiesV1`: 2 active UAT authorities, each carrying two role signatures. Both are excluded. Proposal: production starts with no inherited authority; CPU must perform a fresh matrix review and dual signature against production source hashes.
- `fikaCpuMasterAllergenReviewsV1`: 10 UAT review documents (signed and pending) are excluded. No signature, packet, current pointer or release receipt is trusted in production.
- AUTHMOD: 8 identity records have Firebase staging UID bindings to remove. IDs: `authid:0015ad37-ea53-48c2-9ba9-98a6b916c12f`, `authid:10ad9dda-bb54-4916-b607-23ed45e7c352`, `authid:1b54c6c7-fef7-4254-8eb5-35372a6f976a`, `authid:322c9897-c262-4c7e-ab41-86ceda4a4004`, `authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7`, `authid:7a8d1165-7c05-4e60-83e9-9df0f2d4e7b8`, `authid:7f394423-c9cd-431e-8e21-b714b0d64dff`, `authid:bb33ee7c-91df-4042-8906-e1925fd58545`.
- Seven identities have `fullAccess=true`; clear that flag to `false` in the copy. The copier preserves stable identity IDs, names, normalized email, provenance, legend linkage and historical actor references; it removes only `externalProvider`/`externalUid` bindings and resets `fullAccess`. No AUTHMOD grants or assignments are copied. The two transforms affect 8 and 7 records respectively (9 distinct identities).
- A recursive scan found five documents with `projectId=fika-os-dev`: four under CPU propagation-outbox `delivery` payloads and one Menu Planning cleanup receipt. All five documents are excluded. No retained document has that value. Preserve source project IDs in historical evidence; never relabel those five records as production.
- `rolling-week:2026-08-24` is **not orphaned in the source**: its week parent, seven day documents and 22 entry documents exist (30 docs total). There are 44 matching documents in the inventory: 30 Menu Planning hierarchy docs, 6 CPU changes, 6 CPU receipts and 2 CPU day projections. None occur in retained paths; the operational references are excluded with their closure.
- No other retained-to-excluded operational reference was identified for this week. SOL should still verify cross-domain referential closure before approving apply.

## Projection and feed reset

- CPU has 63 day/week projections. Mixed-source document IDs are `2026-09-16`, `2026-09-23`, `2026-10-13`, `2026-10-19`, `week:2026-09-14`, `week:2026-09-21`, `week:2026-10-12`, and `week:2026-10-19`. These combine Menu Planning, Hospitality Booking and/or Grab & Go lineages. Exclude all 63 projection docs and rebuild only from future production sources.
- CPU's global change cursor is 991; its change collection has 991 records and receipt collection has 689. Exclude changes, receipts and cursor. Start production with an empty feed/initial cursor, then create fresh events from production-owned mutations; do not preserve sequence 991 across excluded gaps.
- Logistics has 37 day projections. Mixed-source documents are `2026-09-16`, `2026-09-23`, `2026-10-12`, and `2026-10-19` (CPU Production plus Grab & Go). Exclude all 37 day projections and rebuild only after production requirements exist.
- Logistics has 892 change records and 38 cursor documents (37 day cursors plus `global`, whose sequence is 892). Exclude the full feed and every cursor; initialize the production global/day partitions from zero/new events. Do not copy source cursors or replay staging sequence gaps.

## Retained immutable package objects

Exactly two current package-head objects are retained for later byte-preserving copy into the production package bucket:

1. `integration-hub/hospitality-catalogue/v1-132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd.json.gz` — 6,331 compressed bytes; SHA-256 `132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd`.
2. `snapshots/menu-planning/catalogue/v7-b79546b1f5984f36f70e6b972948b10dd12443ae945c9d2e8764032f893afe8f.json.gz` — 26,495 compressed bytes; SHA-256 `b79546b1f5984f36f70e6b972948b10dd12443ae945c9d2e8764032f893afe8f`.

Both objects were fetched with decompression disabled; the compressed-byte hashes matched their immutable names/manifests and each gzip payload parsed. Do not copy prior CPU or Delivered-In package objects: their Firestore heads are excluded with operational state. Object transfer and production manifest publication are not part of the Firestore copier and need a separate reviewed step.

## Copier status and remaining SOL decisions

`tools/firestore-bootstrap/cli.mjs` is a dry-run-by-default recursive Firestore planner/copier. It uses exact paths, a per-document source hash, a deterministic `planHash`, a strict retention/exclusion table, the two explicit AUTHMOD transforms, destination-empty enforcement, create-only writes, per-document read-back verification, conflict-safe retry and a resumable local journal. Apply requires `--apply`, the matching `--plan-hash`, `FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH` with the same hash, a fresh matching source snapshot, and `invariantProblems: []`. It was not run in apply mode.

- Tests: `node --test tools/firestore-bootstrap/engine.test.mjs` — 5/5 passed. CLI/engine syntax checks passed.
- SOL should decide whether the **140 published Hospitality Menu Offering** records are the intended sparse OPLOC exceptions. This differs from the recent staging release note of six active exceptions; the plan preserves all 140 and all 243 immutable Offering revisions rather than silently discarding source data.
- SOL should confirm the broad Hub canonical snapshot (which also includes non-Hospitality canonical entities) and the 19 retained identity profiles are appropriate. Staging identity bindings and full-access flags are sanitized, and all staging grants/assignments are excluded.
- SOL should confirm source-side governance audit retention is sufficient for this bootstrap: all 985 staging Hub governance audit docs stay in staging; copied canonical revisions retain their original actor IDs and revisions.
- Verify package manifests and production bucket destinations again immediately before any separately approved object transfer. No production Firestore write, App Hosting rollout, push or email enablement occurred.
