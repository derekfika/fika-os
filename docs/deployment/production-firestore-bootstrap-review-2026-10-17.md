# Production Firestore bootstrap and package review — 2026-10-17

## Fresh read-only source snapshot and executable plan

- Source: `fika-os-dev`; destination: `fika-os`.
- **Superseding review note (2026-10-17):** the Menu Planning catalogue mismatch reported below was caused by the verifier hashing all 404 collection records, including five sandwich records outside the publisher's dish-only source query. The package is current. Derek has now approved the exact current 21-product Grab & Go package as the production source in the Operations/CPU catalogue-owner capacity. The prior `planHash` and 2,258/10,285 candidate counts are superseded; a new full inventory and plan are recorded below.
- Fresh inventory captured `2026-10-17T14:06:22.399Z` UTC using paginated Firestore REST `listCollectionIds` and `documents.list?showMissing=true`.
- Source: **12,543 actual documents / 203 collection paths / 0 missing-parent placeholders**. Destination: **0 actual documents / 0 collection paths / 0 missing-parent placeholders**.
- `showMissing=true` was used at every collection level. Missing-parent documents were traversed without counting them as actual documents; none were found in this snapshot.
- Complete executable plan: `%TEMP%\fika-firestore-bootstrap-final-2026-10-17.json`. It contains the full deterministic action body and its embedded hash; the inventory timestamp is reported separately and is not part of `planHash`.
- Fresh `sourceHash`: `22f6ade05d54237e24927ad168a4724c140bd848f434cfa0ec24025960424f4b`.
- Fresh `planHash`: `efd1eed3c5f1271b681ced3390ed656ee0b99b3dff3f458f64f0c457f57a74b4`.
- Exact object-transfer specification: [production-object-transfer-spec-2026-10-17.json](production-object-transfer-spec-2026-10-17.json), SHA-256 `667276e44eb19d972fd3a95cfbc6a89a9e87bed2a95a7d076ff23f36cc8164b1`.
- Fresh candidate: **2,259 retained / 10,284 excluded / 9 distinct documents transformed** (8 staging Firebase bindings cleared; 7 `fullAccess` flags reset, with overlap).
- `invariantProblems: []`; all 12,543 source paths reconcile with the action set and the destination is empty.

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
| `fikaMenuPlanningCatalogueManifests` | 1 |
| `authmodApplications` | 7 |
| `authmodIdentities` | 19 |
| **Total retained** | **2,259** |

The canonical Hospitality heads are 90 Items (46 active, 44 archived), 140 Offerings (6 active sparse exceptions, 134 archived) and 82 Prices (43 active, 39 archived). All 140 Offering heads and their immutable revisions are retained unchanged. No Offering is collapsed or reactivated; no Item × OPLOC fan-out is created. The runtime package is rebuilt from 46 active Items, 6 active sparse exceptions and 19 active OPLOCs.

All 404 Menu Planning catalogue collection records remain retained as source history. The publisher reads only the 399 `kind=dish` records; five `kind=sandwich` records are outside this package's source identity. The manifest head is retained after matching the publisher's source hash against those 399 dishes. The package does not need a staging rebuild.

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
| **Total excluded** | **10,284** | |

The two AUTHMOD transforms remain unchanged: remove staging Firebase UID bindings from 8 identities and set `fullAccess=false` on 7 identities. Neither grants nor staging assignments are copied.

## Copier approval, discovery and journal safeguards

- The plan hash covers the complete deterministic executable body, including actions, target paths/hashes, source hashes, transforms, exclusions, project pair, destination baseline and missing-parent placeholders. `generatedAt` is not in that body.
- Apply verifies the saved body against its embedded hash, the freshly generated in-memory plan, `--plan-hash`, and `FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH`. It executes only the freshly generated in-memory plan.
- Recursive inventory uses Firestore REST `showMissing=true`; placeholders are traversed and included in the source-state hash but never counted as actual documents. Any placeholder with descendants is an apply-blocking invariant.
- Journals are stored locally under a plan-hash-derived path. Journal schema, source/destination project identity, plan hash, each authorized path, source/target hashes, transform IDs and verification status are checked before resuming. Journal replacement uses a same-directory temporary file and rename.
- Source documents are re-read and source/transform hashes checked before each create-only write. After apply, the CLI would perform a fresh recursive destination inventory and reject any missing, extra, differing, duplicate, or placeholder path against the exact expected destination set.
- Tests include SOL's altered excluded-booking action attack and mutations to actions/target paths, transforms, exclusions, source hash, project identity, actual fresh source state and journal entries. All abort before a write adapter can run.

## Complete read-package / GCS inventory

Read-only recursive inventory of `gs://fika-os-dev-staging-read-packages-europe-west4/**` was rerun for this plan: **3,185 objects / 9,710,303 bytes**, including **112 manifest objects** and **3,073 package/artifact objects**. GCS returned MD5 and CRC32C metadata for all objects. No bucket writes or deletes were made.

| Object family | Manifest objects | Package/artifact objects | Classification |
| --- | ---: | ---: | --- |
| Hospitality private catalogue (`integration-hub/hospitality-catalogue`) | 1 | 1 | Current; retain exact immutable object and manifest contract for Hub runtime. |
| Hospitality public catalogue (`hospitality-booking/catalogue`) | 1 | 1 | Current; retain exact immutable public projection and manifest contract for Hospitality runtime. Both are projections of the same global catalogue, not site fan-out. |
| Menu Planning catalogue (`snapshots/menu-planning/catalogue`) | 1 | 52 | Current manifest and v7 object match the publisher's dish-only source identity and package semantics. The other 51 are superseded historical package versions. Transfer only the current manifest/object pair under the separately reviewed object-transfer step. |
| Daily signed OPLOC bundles | 33 | 52 | Immutable staging safety/operational evidence; retain in staging for audit, exclude from production bootstrap. |
| CPU Production snapshots and packages | 51 | 2,328 | Exclude CPU operational/derived packages. Retain the separately approved global Grab & Go catalogue object in the object-transfer specification below. |
| Delivered-In day and projection-index packages | 18 | 606 | Staging operational projections; exclude. Rebuild only from future production-owned downstream state. |
| Integration Hub reference/cache packages | 4 | 12 | Rebuildable cache packages; exclude staging manifests and objects, then rebuild from production canonical/reference state. |
| Integration Hub AUTHMOD access packages | 3 | 21 | Staging authorization packages; exclude and provision in production. |
| **Total** | **112** | **3,073** | Fresh recursive object listing reconfirmed these counts and the selected current objects. |

### Current Hospitality package verification

Both current Hospitality objects were downloaded with transparent gzip decompression disabled. Compressed byte count and SHA-256 matched the manifest and content-addressed object name. Their gzip payloads parsed, and the package content was rebuilt from the fresh retained canonical heads/routing records and compared recursively:

- Private Hub package: `integration-hub/hospitality-catalogue/v1-132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd.json.gz`, **6,331 bytes**, SHA-256 `132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd`; exact payload match, 46 Items / 6 exceptions / 19 OPLOCs.
- Public Hospitality package: `hospitality-booking/catalogue/fd632150394cd2c7624b6ff645402554146efa2608594412efe83202014da784.json.gz`, **6,273 bytes**, SHA-256 `fd632150394cd2c7624b6ff645402554146efa2608594412efe83202014da784`; exact public projection match, 46 Items / 6 exceptions / 19 OPLOCs.

For a separately reviewed object-transfer step, copy only those two immutable compressed objects to the production package bucket `fika-os-prod-read-packages-europe-west4`, preserving bytes. Verify SHA-256 before publishing the matching Hub and public package manifests. Do not copy the staging `manifests/` tree wholesale.

### Exact production object-transfer specification

The current staging object listing was re-read and totals 3,185 objects / 9,710,303 bytes. Transfer only these four immutable objects to the matching key in `gs://fika-os-prod-read-packages-europe-west4`; preserve the compressed bytes and verify the target SHA-256 before publishing a production manifest:

| Package | Source object | Bytes / compressed SHA-256 | Production publication requirement |
| --- | --- | --- | --- |
| Menu Planning catalogue v7 | `snapshots/menu-planning/catalogue/v7-b79546b1f5984f36f70e6b972948b10dd12443ae945c9d2e8764032f893afe8f.json.gz` | 26,495 / `b79546b1f5984f36f70e6b972948b10dd12443ae945c9d2e8764032f893afe8f` | Publish `manifests/menu-planning/catalogue.json` only after verifying the 399-dish source hash `5f3ae96035f327284ac1ea557071cccb9b04effae6149890f5d5e8378a577215` and matching object hash/size. |
| Approved Grab & Go global catalogue v1 | `snapshots/cpu-production/grab-and-go-catalogue/v1-b33963e3f45a3930d2511c9e23cd14921b822c7ef5c4660ad39544c2fe68719f.json.gz` | 1,009 / `b33963e3f45a3930d2511c9e23cd14921b822c7ef5c4660ad39544c2fe68719f` | Publish `manifests/cpu-production/grab-and-go/catalogue.json` for the approved 21-product global source. Do not transfer staging orders, standing orders, or handoffs. |
| Hub Hospitality private catalogue v1 | `integration-hub/hospitality-catalogue/v1-132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd.json.gz` | 6,331 / `132bddec68e6c4d7250a6fb5443f81bb74e2ffc886cdc74be040931a6cc94bcd` | Publish matching `manifests/integration-hub/hospitality-catalogue.json` after verifying the production canonical projection and exact target object bytes. |
| Hospitality public catalogue v1 | `hospitality-booking/catalogue/fd632150394cd2c7624b6ff645402554146efa2608594412efe83202014da784.json.gz` | 6,273 / `fd632150394cd2c7624b6ff645402554146efa2608594412efe83202014da784` | Publish matching `manifests/hospitality-booking/catalogue.json` after verifying its routing-redacted public projection and exact target object bytes. |

The four staging manifests are evidence for the source identities and object keys; do not copy the staging manifest tree wholesale. Production publication must use the production package-store path and the approved package manifest values. No other CPU Production or Delivered-In operational, day, projection, release, or cursor package is in this transfer set; those packages remain excluded.

### Menu Planning package verification — corrected

The staging manifest `manifests/menu-planning/catalogue.json` points at `snapshots/menu-planning/catalogue/v7-b79546b1f5984f36f70e6b972948b10dd12443ae945c9d2e8764032f893afe8f.json.gz` (26,495 compressed bytes, 215 entries). Its declared source hash is `5f3ae96035f327284ac1ea557071cccb9b04effae6149890f5d5e8378a577215`. The publisher queries only `kind=dish`, so the exact source set is 399 dishes; five `kind=sandwich` records in the 404-record collection are not package inputs. Recomputing with the publisher's `catalogueSourceHash` semantics over the 399 dishes yields the manifest's exact `5f3ae96035f327284ac1ea557071cccb9b04effae6149890f5d5e8378a577215`. A fresh build from those source records also yields the stored package's exact 215 entries and five categories. Root cause: the earlier bootstrap analysis incorrectly hashed all 404 collection records. No republish was needed or performed. The package is current and eligible for production transfer, subject to the separate reviewed object-transfer step.

The single CPU Grab & Go catalogue package is a CPU-owned global reference package, not part of the Hospitality catalogue. Staging manifest `manifests/cpu-production/grab-and-go/catalogue.json` points to `snapshots/cpu-production/grab-and-go-catalogue/v1-b33963e3f45a3930d2511c9e23cd14921b822c7ef5c4660ad39544c2fe68719f.json.gz`; compressed SHA-256 is `b33963e3f45a3930d2511c9e23cd14921b822c7ef5c4660ad39544c2fe68719f`, with 21 products, all active (18 `grab_250ml`, 3 `stacking_salad_750ml`). Derek's domain-owner approval is recorded below and the exact package is included in the transfer specification. The publisher and schema contain no approval flag or signature; AUTHMOD's explicit Publish/Approve capability policy remains applicable to any future governed publishing path. Staging operational documents remain excluded: `fikaDeliveredInGrabAndGoOrdersV1` (8), `fikaDeliveredInGrabAndGoStandingOrdersV1` (3), and `fikaDeliveredInGrabAndGoHandoffV1` (8); none are transferred as catalogue approval evidence.

#### Recorded Grab & Go domain-owner decision

On 2026-10-17, Derek recorded: **“YES — approve the current 21-product Grab & Go catalogue as the production source.”** He confirmed these are the current rolling menu products and the only products uploaded for this catalogue. This is recorded as the domain-owner business decision for the Operations/CPU catalogue owner. It approves the exact package identity above; it does not approve or retain staging orders, standing orders, handoffs, or other operational state. AUTHMOD's separate Publish/Approve capability policy remains in force for any future governed publication flow.

## Validation and deployment state

- `node --test tools/firestore-bootstrap/engine.test.mjs` — **13/13 passed**, including exact plan-body/hash binding, source drift, `showMissing` traversal guard, plan-scoped journal validation, create-only behavior and final destination exact-set verification.
- `npx tsx --test tests/read-package.test.ts` in `apps/menu-planning` — **8/8 passed**, including publisher/bootstrap hash parity.
- Grab & Go source/package tests — **4/4 passed**; Hub Hospitality package tests — **6/6 passed**; Hospitality consumer package tests — **3/3 passed**.
- `node --check tools/firestore-bootstrap/engine.mjs` and `node --check tools/firestore-bootstrap/cli.mjs` — passed.
- Fresh source/destination recursive inventory — completed at `2026-10-17T14:06:22.399Z` UTC; 12,543 source documents, 2,259 retained, 10,284 excluded, 9 transformed, 0 source placeholders, 0 destination documents/placeholders, `invariantProblems: []`.
- GCS recursive object/manifest inventory — completed read-only; the four specified compressed objects were downloaded with decompression disabled and their exact byte counts and SHA-256 values matched their content-addressed manifest identities.
- Production Firestore apply, GCS production transfer/write, App Hosting deployment, email enablement and push — **not performed**.

The fresh complete plan is prepared for final SOL review at the stated plan hash. It is read-only and has not been applied. No production Firestore/GCS write, App Hosting deployment, email enablement, or push was performed. Staging Firestore and GCS were read only.
