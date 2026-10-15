# Hospitality canonical catalogue: one Menu Item, many site offerings

Status: **code and migration tooling implemented; the data migration has NOT been run anywhere.** Nothing here mutates staging or production.

## Target model

```
canonical Hospitality Menu Item   identity, name, canonical description, category,
                                  dietary + allergen data, provider/source mappings,
                                  lifecycle, CPU production routing   (stored ONCE)
        ▲
        │ hospitalityMenuItemId
        │
Hospitality Menu Offering (per site/OPLOC [+ area] + mode)
                                  availability (lifecycleState), lead time, minimums,
                                  serving info, ordering/choice configuration, sort order,
                                  optional site-local displayName / description
        ▲
        │ hospitalityMenuOfferingId
Hospitality Menu Price (per offering, effective-dated)
```

The Item/Offering/Price entities already existed. What was wrong was the data and the tooling around them:

* the checked-in catalogues and the promotion scripts created **site-prefixed Items** (`hospitality-menu-item:mnk:bagel_box`, `hospitality-menu-item:rcoa:bagel_box`), so each site owned its own copy of the same product;
* production routing is stored per Item, so it had to be decided once per site copy (the routing screen showed `Bagel Box — RCoA` and `Bagel Box — MNK`);
* the existing manual "merge Menu Items" command repointed offerings but **left the source's routing decision orphaned** and never reconciled it.

## What changed

| Area | Change |
| --- | --- |
| `lib/hospitality-catalogue-canonicalisation.ts` (new, pure) | Inventory, evidence-tiered merge groups, review list, declarative merge operations, dry-run application and post-merge invariants. |
| Offering schema | `configuration.displayName` / `configuration.description` (optional): the only place a site-local wording lives. Portal read serves the override, otherwise the canonical Item wording. |
| Merge command (`connections-service.ts`) | Routing is reconciled inside the merge transaction: inherited by the survivor if only the source was routed, left alone if they agree, **merge refused if they disagree**. The source routing record is kept as history and marked `supersededBy`. |
| Routing projection | Superseded rows are ignored; a merged-away Item ID resolves to the survivor's single routing decision (orders, quotes and Production Orders that still carry the old ID keep routing). |
| Routing review (Hub) | One row per active canonical Item (already filtered to non-archived); `scopes` lists every site offering it. Archived duplicates disappear after the merge. |
| Brochure review | Creating a *new* canonical Item is refused when an active Item with the same name or source id exists, unless the reviewer sets `confirmDistinctItem`. The normal path is "select the existing Item, add this site's Offering". |
| Seed scripts | `promote-local-portal-menu-items.ts` and `create-site-menu-offerings.ts` resolve a product to its existing canonical Item (same exact source id, name, category, allergen and dietary data) instead of minting another site-prefixed Item. |
| `scripts/hospitality-catalogue-canonicalisation.ts` | Read-only report (`--snapshot` or `--live`); guarded `--apply`. |

## Evidence rules (nothing merges on display name alone)

An automatic merge group requires **all** of:

1. the items come from **different** sites;
2. they share an **exact source item id** (provider mapping, provider-owned legacy id, or the id suffix of a site-prefixed Item);
3. identical normalised **name** and **category**;
4. identical **allergen** and **dietary** data (safety data is never reconciled by the tool).

Everything else is reported, never merged: shared source id but a different name or allergen data; same name with no shared id; similar names in one category across sites; two same-name items inside one site. An item that already has a confirmed twin is not also suggested as a duplicate of something else. A group is also held back for review if two offerings would collide (same OPLOC / area / mode) or if the two items carry **different routing decisions**.

Survivor choice is deterministic: the item already carrying a routing decision, then the one with most offerings, then ID order. Existing IDs are kept, so no stored reference changes; the merge map resolves the archived IDs.

## Current duplicate inventory (staging, read-only snapshot taken 2026-10-15)

Read directly from `fika-os-dev` Firestore with queries only.

| | Count |
| --- | --- |
| Active Hospitality Menu Items | **89** (43 `mnk`-prefixed, 46 `rcoa`-prefixed) |
| Hospitality Menu Offerings | 43 (all MNK; **RCoA has no Offerings yet**) |
| Hospitality Menu Prices | 42 |
| Production routing records | 8 (all on `rcoa` Items) |
| Existing merge records | 0 |

### Proposed canonical merge groups (decisive evidence)

* **39 groups** (every MNK product that has an RCoA twin with the same source id, name, category and allergen/dietary data) → 39 Items archived, **89 → 50** active Items.
* Survivors: 33 stay the MNK Item (it carries the offering); **6 survive as the RCoA Item** because those 6 already carry the routing decision (`deli_sandwich_lunch`, `exotic_fruit_box`, `filled_savoury_croissant`, `large_pastries`, `mini_pastries`, `vegan_savoury_croissant`).
* **Offerings affected: 6** (MNK offerings of those 6 products are repointed to the RCoA survivor). The other 37 MNK offerings do not move; their twin RCoA Items are archived and future RCoA offerings will reference the survivor.
* **Routing records affected: 8 exist.** 6 are on surviving Items and are kept unchanged (no routing writes, no inheritance needed). 2 are on Items held back for review (below). 0 conflicts among the decisive groups.
* Two groups carry a presentation note only (`Fika Canapes`, `Fika Corporate Dining`: casing differs). The wording is preserved as an Offering override if the RCoA Offering uses a different display name.

### Ambiguous groups needing review (not merged)

| Items | Why |
| --- | --- |
| `mnk:cookie_box` / `rcoa:cookie_box` | same source id, name differs (“Freshly Baked Cookie Box” / “Cookie Box”). **RCoA copy is routed.** |
| `mnk:tray_bake_box` / `rcoa:tray_bake_box` | same source id, name differs and **allergen information differs** (RCoA: “Traybake Box — Contains Nuts”). **RCoA copy is routed.** |
| `mnk:glow_bowl` / `rcoa:glow_bowl` | same source id, but “Fika Glow Bowl” vs “Propper Salads”: possibly a different product. |
| `mnk:bloom_filter_coffee` / `rcoa:house_filter_coffee` | similar names, no shared source id. |

### Unmatched (RCoA-only, left alone)

`rcoa:doughnut_box`, `rcoa:loaf_cake`, `rcoa:tray_bake_box_nut_free`.

Re-run the report against the real target at approval time; this table is a point-in-time reading. Counts for production must come from a production read, which has not been performed.

## Migration plan

1. **Inventory (read-only).** `npx tsx scripts/hospitality-catalogue-canonicalisation.ts --live --project <id> --dump snapshot.json --out report.json`. Needs Firestore read access only. Commit nothing from the output.
2. **Review.** A human resolves the review list: either approve a specific merge (for example by using the existing merge command once the differences are settled, e.g. aligning the allergen data first) or confirm the items are distinct. Resolve any routing disagreement first.
3. **Freeze point.** Take a Firestore export of `integrationHubCanonical`, `integrationHubHospitalityMenuProductionRouting`, `integrationHubHospitalityMenuItemMerges` and `integrationHubGovernanceAudit` (rollback source).
4. **Approve.** Note the report's `planHash`. Approval is a separate act: set `FIKA_CATALOGUE_CANONICALISATION_APPROVED=<planHash>` and pass `--plan-hash <planHash>`.
5. **Apply on staging first.** `--live --project fika-os-dev --apply --plan-hash <hash>`. Each group runs in its own transaction and is idempotent. The tool refuses unless the dry run satisfies every invariant (offering/price counts unchanged, no offering points at an archived Item, no duplicate offering key, every prior routing decision still resolves to the same workstreams, no Item disappears without a merge record).
6. **Verify on staging:** the Hub routing screen shows one row per product; an MNK order and a CPU hand-off for a merged product still route; the MNK portal menu is unchanged.
7. **Production** only after steps 1–6 are repeated against production data and the plan hash is re-approved. `--apply` against project `fika-os` additionally requires `--allow-production`.

## Review blocker corrections (2026-10-15)

Bounded routing reads fetch merge documents by requested stable Item ID and follow only the resolved survivor chain (maximum 32 merge-document reads per chain, with shared reads coalesced within a request). Only the terminal routing document is read. A current Item normally costs one merge lookup and one routing lookup; a one-hop merged Item costs two merge lookups and one routing lookup. Cold and warm requests use this same bounded shape; no cross-request cache or periodic work is added. Cycles, malformed/overlong chains and superseded decisions fail closed. Historical IDs return the survivor decision under the original requested ID. Catalogue-wide callers retain their existing full projection path.

Each merge group contains a detached expected snapshot of all member Items (including provider mappings), member routing/merge documents and source/survivor Offerings. These expectations participate in the reviewed plan hash. Apply rereads those records inside the group's Firestore transaction and compares their complete stable hashes before any writes. Scoped Offering queries detect new or repointed Offerings as well as changed records; there are no full-collection reads in a group transaction. The read shape is one audit receipt, three direct document reads and one scoped Offering query per member, plus reads of reviewed Offerings no longer returned by those queries. This explicitly invoked maintenance operation adds no recurring reads.

Changed or newly appearing relevant state aborts the whole group with a stale-plan/conflict diagnostic and requires regeneration and review. The merge is never recomputed under the old approval. Post-merge invariants are checked again before committing. A deterministic governance audit receipt commits atomically with the group and records reviewed/committed state hashes. An exact unchanged retry is a no-op; changes after a successful apply reject replay. CLI restart still recomputes the remaining live plan, so an interrupted run requires review and approval of the new remaining plan hash. Existing approval/environment/production gates and review-only groups remain unchanged.

No migration or deployment was performed for these corrections.

### Correction validation

- Focused catalogue, contract, routing and apply suites: 43/43 pass using `npx tsx --test tests/hospitality-catalogue-canonicalisation.test.ts tests/hospitality-catalogue-contract.test.ts tests/hospitality-menu-routing.test.ts tests/hospitality-catalogue-apply.test.ts tests/hospitality-routing-suggestions.test.ts` from Integration Hub.
- `npm run typecheck`, `npm run build` and `git diff --check`: pass.
- The unfiltered `npm test` run stalled on Firestore-dependent tests in both the corrected branch and unchanged `main` at `615cd9bb9a3b5ce6a30b7dba59fec5d9f919b36a`. A repeat with `--test-timeout=30000 --test-force-exit` confirmed the first database-dependent timeout; these runs were terminated rather than treated as passing.
- Completed broader comparison: enumerate `tests/*.test.ts` and `tests/*.test.cjs`, exclude the five files below, and run `npx tsx --test --test-force-exit <relative test paths>`. Corrected branch: 531 pass / 13 fail (544 total). Unchanged main: 495 pass / the same 13 fail (508 total). No new failure names in the completed comparison.
- Excluded files requiring Firestore: `booking-email-firestore.test.ts`, `fulfilment-projection.test.ts`, `logistics-event-identity.test.ts`, `production-domain.test.ts`, `production-fulfilment-reconciliation.test.ts`. No live/emulator cross-app end-to-end success is claimed. Apply regressions use an isolated transactional adapter, with no persistent writes.

The 13 baseline failures reproduced on main concern: ADDR-001 acceptance; session-cookie rejection; canonical-boundary pagination; BrightHR completeness; the Connections home CSS import; service/allocation confirmation; three Delivered-In access assertions; Logistics admission tracing; two Service Definition package assertions; and staffing cancellation. This is a larger pre-existing failure set in this environment than the two previously documented below. These unrelated tests/source files were not modified.

## Rollback plan

* Nothing is deleted. Archived Items keep their record (`lifecycleState: archived`), their provider mappings and their original ID; the merge map records source → survivor; source routing records are kept with `supersededBy`; every group writes a governance audit entry.
* To revert a group: set the archived Item's `lifecycleState` back to `active`, repoint the moved Offerings' `hospitalityMenuItemId` to the original Item (the audit entry and merge record list them), delete the survivor's `inheritedFrom` routing copy if one was created, clear `supersededBy` on the source routing record, delete the merge record. Because only the 6 routed survivors repointed offerings, this is a small, listed set.
* Full rollback: restore the step 3 export. Run the report again to confirm the plan matches the pre-migration state.
* The code changes are additive (new optional offering fields, stricter brochure creation, routing projection that ignores `supersededBy` and follows the merge map) and are safe to deploy before any data is migrated.

## Known follow-ups

* The Hospitality portals still read their own checked-in catalogues for some sites. Moving every site brochure to Hub Offerings is a separate piece of work; this change makes that move reuse the shared Items.
* The four review groups need a product decision (and, for the tray bake box, an allergen-data decision) before they can be merged.
* Hub test files `connections-home.test.ts` (imports a `.css` file under `tsx`) and `connections-lifecycle-actions.test.ts` already fail on `main` and are unrelated.
