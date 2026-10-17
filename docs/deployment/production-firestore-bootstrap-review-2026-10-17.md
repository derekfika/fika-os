# Production Firestore bootstrap and package review — 2026-10-17

## Read-only source snapshot

- Source: `fika-os-dev`; destination: `fika-os`.
- Inventory captured `2026-10-17T13:54:11.728Z` UTC using paginated Firestore REST `listCollectionIds` and `documents.list?showMissing=true`.
- Source: **12,543 actual documents / 203 collection paths / 0 missing-parent placeholders**. Destination: **0 actual documents / 0 collection paths / 0 missing-parent placeholders**.
- `showMissing=true` was used at every collection level. Missing-parent documents were traversed without counting them as actual documents; none were found in this snapshot.
- The full path/hash plan is local at `%TEMP%\fika-firestore-bootstrap-fresh-plan.json`; the inventory timestamp is reported separately and is not part of `planHash`.
- Fresh `sourceHash`: `22f6ade05d54237e24927ad168a4724c140bd848f434cfa0ec24025960424f4b`.
- Fresh `planHash`: `9a5b9a80055e432e08d7331fe95291931f3a728cba6c0ee3574c1191f740384e`.
- Candidate: **2,258 retained / 10,285 excluded**. `invariantProblems: []`; exact document paths reconcile and the destination is empty.

## Firestore retention plan

| Retained root | Documents |
| --- | ---: |
| `integrationHubCanonical` | 1,077 |
| `integrationHubCanonicalRevisions` | 610 |
| `integrationHubHospitalityMenuItemMerges` | 42 |
| `integrationHubHospitalityMenuProductionRouting` | 52 |
| `integrationHubHospitalityCatalogueReviewDecisions` | 6 |
| `integrationHubSourceMappings` | 41 |
| `fikaMenuPlanningCatalogue` | 404 |
| `authmodApplications` | 7 |
| `authmodIdentities` | 19 |
| **Total retained** | **2,258** |

The canonical Hospitality heads are 90 Items (46 active, 44 archived), 140 Offerings (6 active sparse exceptions, 134 archived) and 82 Prices (43 active, 39 archived). All 140 Offering heads and their immutable revisions are retained unchanged. No Offering is collapsed or reactivated; no Item × OPLOC fan-out is created. The runtime package is rebuilt from 46 active Items, 6 active sparse exceptions and 19 active OPLOCs.

All 404 Menu Planning catalogue source records are retained. The single `fikaMenuPlanningCatalogueManifests/catalogue` cache head is excluded because its claimed source hash does not match the fresh source. The copier's exclusion reason is `stale-menu-catalogue-package-head`; the package must be rebuilt before publishing a production head.

| Exclusion group | Documents | Treatment |
| --- | ---: | --- |
| AUTHMOD staging access/import state | 339 | Provision production grants and assignments through production AUTHMOD administration. |
| Hospitality booking history | 287 | Exclude staging bookings, groups, quotes, notifications and audit. |
| Menu operational history | 2,442 | Exclude weeks, publications, snapshots, events, outbox and archive pointers. |
| Delivered-In operational state | 270 | Exclude projections, site menus, releases, receipts and Grab & Go handoffs/orders. |
| CPU operational/derived state | 3,436 | Exclude plans, feeds, projections, receipts, package heads, releases and outboxes. |
| Logistics operational/derived state | 1,362 | Exclude movements, assignments, projections, feeds, cursors and outboxes. |
| Production/Fulfilment/domain-event closure | 1,159 | Start production operational closure empty. |
| Staging governance audit | 985 | Keep in staging; do not relabel it as production history. |
| Staging-specific settings/migration/cache state | 4 | Recreate or rebuild for production. |
| Stale Menu Planning catalogue package head | 1 | Rebuild from retained authoritative catalogue records. |
| **Total excluded** | **10,285** | |

The two AUTHMOD transforms remain unchanged: remove staging Firebase UID bindings from 8 identities and set `fullAccess=false` on 7 identities. Neither grants nor staging assignments are copied.

## Copier approval, discovery and journal safeguards

- The plan hash covers the complete deterministic executable body, including actions, target paths/hashes, source hashes, transforms, exclusions, project pair, destination baseline and missing-parent placeholders. `generatedAt` is not in that body.
- Apply verifies the saved body against its embedded hash, the freshly generated in-memory plan, `--plan-hash`, and `FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH`. It executes only the freshly generated in-memory plan.
- Recursive inventory uses Firestore REST `showMissing=true`; placeholders are traversed and included in the source-state hash but never counted as actual documents. Any placeholder with descendants is an apply-blocking invariant.
- Journals are stored locally under a plan-hash-derived path. Journal schema, source/destination project identity, plan hash, each authorized path, source/target hashes, transform IDs and verification status are checked before resuming. Journal replacement uses a same-directory temporary file and rename.
- Tests include SOL's altered excluded-booking action attack and mutations to actions/target paths, transforms, exclusions, source hash, project identity, actual fresh source state and journal entries. All abort before a write adapter can run.

## Complete read-package / GCS inventory

Read-only inventory of `gs://fika-os-dev-staging-read-packages-europe-west4/**` captured `2026-10-17T13:54:31.583Z` UTC: **3,185 objects / 9,710,303 bytes**, including **112 manifest objects** and **3,073 package/artifact objects**. GCS returned MD5 and CRC32C metadata for all 3,185 objects. No bucket writes or deletes were made.

| Object family | Manifest objects | Package/artifact objects | Classification |
| --- | ---: | ---: | --- |
| Hospitality private catalogue (`integration-hub/hospitality-catalogue`) | 1 | 1 | Current; retain exact immutable object and manifest contract for Hub runtime. |
| Hospitality public catalogue (`hospitality-booking/catalogue`) | 1 | 1 | Current; retain exact immutable public projection and manifest contract for Hospitality runtime. Both are projections of the same global catalogue, not site fan-out. |
| Menu Planning catalogue (`snapshots/menu-planning/catalogue`) | 1 | 52 | Current manifest points at a stale v7 object; exclude all staging objects and rebuild from the retained 404 source records. The other 51 are superseded historical package versions. |
| Daily signed OPLOC bundles | 33 | 52 | Immutable staging safety/operational evidence; retain in staging for audit, exclude from production bootstrap. |
| CPU Production snapshots and packages | 51 | 2,328 | Staging operational/derived packages; exclude. The global Grab & Go catalogue object also remains excluded until CPU provides its explicitly approved production source file. |
| Delivered-In day and projection-index packages | 18 | 606 | Staging operational projections; exclude. Rebuild only from future production-owned downstream state. |
| Integration Hub reference/cache packages | 4 | 12 | Rebuildable cache packages; exclude staging manifests and objects, then rebuild from production canonical/reference state. |
| Integration Hub AUTHMOD access packages | 3 | 21 | Staging authorization packages; exclude and provision in production. |
| **Total** | **112** | **3,073** | |

### Current Hospitality package verification

Both current Hospitality objects were downloaded with transparent gzip decompression disabled. Compressed byte count and SHA-256 matched the manifest and content-addressed object name. Their gzip payloads parsed, and the package content was rebuilt from the fresh retained canonical heads/routing records and compared recursively:

- Private Hub package: `integration-hub/hospitality-catalogue/v1-132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd.json.gz`, **6,331 bytes**, SHA-256 `132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd`; exact payload match, 46 Items / 6 exceptions / 19 OPLOCs.
- Public Hospitality package: `hospitality-booking/catalogue/fd632150394cd2c7624b6ff645402554146efa2608594412efe83202014da784.json.gz`, **6,273 bytes**, SHA-256 `fd632150394cd2c7624b6ff645402554146efa2608594412efe83202014da784`; exact public projection match, 46 Items / 6 exceptions / 19 OPLOCs.

For a separately reviewed object-transfer step, copy only those two immutable compressed objects to the production package bucket `fika-os-prod-read-packages-europe-west4`, preserving bytes. Verify SHA-256 before publishing the matching Hub and public package manifests. Do not copy the staging `manifests/` tree wholesale.

### Stale Menu Planning package verification

The staging manifest `manifests/menu-planning/catalogue.json` points at `snapshots/menu-planning/catalogue/v7-b79546b1f5984f36f70e6b972948b10dd12443ae945c9d2e8764032f893afe8f.json.gz` (26,495 compressed bytes, 215 entries). Its declared source hash is `5f3ae96035f327284ac1ea557071cccb9b04effae6149890f5d5e8378a577215`. A fresh source read and the production code's `catalogueSourceHash` over all 404 authoritative records produced `c3eed6baa3961906823ea61b2a67ec948e925a92cae303e35cc92effecb720f5`. Therefore the manifest's `packageState: current` flag is stale/incorrect. Do not transfer its manifest or any of the 52 old Menu Planning package objects. Rebuild and verify a new package from the retained source records before publishing a production manifest.

The single CPU Grab & Go catalogue package is a CPU-owned global reference package, not part of the Hospitality catalogue. Its publisher requires an approved source file; no approved source was supplied in this task. Keep that staging object and manifest excluded, and prepare the production package from the approved source in a separate step.

## Validation and deployment state

- `node --test tools/firestore-bootstrap/engine.test.mjs` — **10/10 passed**.
- `node --check tools/firestore-bootstrap/engine.mjs` and `node --check tools/firestore-bootstrap/cli.mjs` — passed.
- Fresh source/destination recursive inventory — completed; 0 source placeholders, 0 destination documents, `invariantProblems: []`.
- GCS recursive object/manifest inventory — completed read-only; selected current and stale compressed packages were verified by exact compressed-byte hash and parse.
- Production Firestore apply, GCS production transfer/write, App Hosting deployment, email enablement and push — **not performed**.

The Firestore plan is ready for review at the stated plan hash. Overall production bootstrap remains **HOLD** until the separately owned CPU Grab & Go production source is approved and the stale Menu Planning package is rebuilt and verified. This report does not authorize apply or object transfer.
