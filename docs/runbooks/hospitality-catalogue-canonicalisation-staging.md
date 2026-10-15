# Runbook: canonicalise the Hospitality catalogue in staging (`fika-os-dev`)

Status: **PREPARED, NOT EXECUTED.** Run only after UAT sign-off. Staging only; production is out of scope (`fika-os` is refused unless `--allow-production`, which this runbook never uses).
Tool: `apps/integration-hub/scripts/hospitality-catalogue-canonicalisation.ts` (engine: `lib/hospitality-catalogue-canonicalisation.ts`, apply: `lib/hospitality-catalogue-apply.ts`). Background: `docs/architecture/hospitality-canonical-catalogue.md`.

Prereqs: on `main` at or after `3a3c51d`; `npm ci` done in `apps/integration-hub`; Application Default Credentials with Firestore access to `fika-os-dev` (`gcloud auth application-default login`). Commit nothing from the outputs below (`$OUT` is outside the repo).

```bash
cd apps/integration-hub
git fetch origin && git status -sb          # record origin/main SHA
export P=fika-os-dev
export OUT=~/hospitality-canon-$(date +%Y%m%d-%H%M)   # keep outside the repo
mkdir -p "$OUT"
```

## 1. Fresh LIVE READ-ONLY report (no `--apply`; queries only)

```bash
npx tsx scripts/hospitality-catalogue-canonicalisation.ts --live --project $P \
  --dump "$OUT/pre.json" --out "$OUT/report.json"
```

Reads `integrationHubCanonical` (Item/Offering/Price by `entityType`), `integrationHubHospitalityMenuProductionRouting`, `integrationHubHospitalityMenuItemMerges`. Writes nothing to Firestore.

**Plan hash:** printed in the console JSON as `"planHash"` and stored at `$OUT/report.json` → `.planHash`.

```bash
node -e "const r=require(process.env.OUT+'/report.json');console.log(r.planHash,r.summary,r.invariantProblems,r.reviewGroups.length)"
```

Re-run step 1 after UAT; the hash only matches the live data it was computed from. Any catalogue/routing/offering change in between changes the hash, so re-review.

## 2. Pre-apply expectations (review `report.json`)

Point-in-time reading of 2026-10-15; a fresh report supersedes it.

| Check | Expected |
| --- | --- |
| `invariantProblems` | `[]` (apply refuses otherwise) |
| Active Items | 89 → 50 (39 archived) |
| Merge groups | 39 (`mergeGroups`) |
| Review groups | 4: `cookie_box`, `tray_bake_box`, `glow_bowl`, `bloom/house_filter_coffee`. Not applied |
| Unmatched | `rcoa:doughnut_box`, `rcoa:loaf_cake`, `rcoa:tray_bake_box_nut_free` untouched |
| Offerings / Prices | 43 / 42, **unchanged** (6 offerings repointed, none created or removed) |
| Routing records | 8 existing; 6 on surviving Items kept, 2 on review-held Items untouched |
| `routingRowsBefore` → `routingRowsAfter` | 89 → 50 (= active Item count) |

If counts differ, STOP and understand why before approving (UAT may legitimately have added Items/Offerings).

## 3. Review groups are excluded from apply

Confirmed in code: `apply` iterates `plan.groups` only (script line `for (const group of plan.groups)`); `plan.review` is reported, never written. Also the `4` review items must still be active, unrouted-or-unchanged, after apply (checked in step 6).

## 4. Freeze point (rollback source)

Bucket `gs://fika-os-dev-firestore-backups-europe-west4` (europe-west4, private, created 2026-10-15; the exporting identity needs `roles/datastore.importExportAdmin` and bucket write). Take a Firestore export of `integrationHubCanonical`, `integrationHubHospitalityMenuProductionRouting`, `integrationHubHospitalityMenuItemMerges`, `integrationHubGovernanceAudit` for `fika-os-dev` (console or `gcloud firestore export gs://fika-os-dev-firestore-backups-europe-west4/canon-$(date +%Y%m%d) --project fika-os-dev --collection-ids=integrationHubCanonical,integrationHubHospitalityMenuProductionRouting,integrationHubHospitalityMenuItemMerges,integrationHubGovernanceAudit`). Keep `$OUT/pre.json` as the logical copy.

## 5. Apply (staging only)

Approval is a separate act: the env var must equal the plan hash, and `--plan-hash` must equal the hash freshly recomputed at apply time.

```bash
export FIKA_CATALOGUE_CANONICALISATION_APPROVED=<FRESH_PLAN_HASH>
npx tsx scripts/hospitality-catalogue-canonicalisation.ts --live --project fika-os-dev \
  --apply --plan-hash <FRESH_PLAN_HASH> --out "$OUT/apply-report.json"
unset FIKA_CATALOGUE_CANONICALISATION_APPROVED
```

Guards: hash mismatch, missing/different env var, any invariant problem, or `--project fika-os` all abort before writes. Output: one `applied <groupId> (<name>)` line per group (39 expected). Each group is its own transaction with stale-state checks and an atomic audit receipt (`integrationHubGovernanceAudit/canonicalisation-<groupId>-<hash>`); an exact repeat is a no-op.

If interrupted or aborted with a stale-plan diagnostic: do **not** reuse the old hash. Re-run step 1, review the remaining plan, set the new `<FRESH_PLAN_HASH>`, apply again.

## 6. Post-apply verification (all read-only)

6a. Re-run the report: the plan should now be empty.

```bash
npx tsx scripts/hospitality-catalogue-canonicalisation.ts --live --project fika-os-dev \
  --dump "$OUT/post.json" --out "$OUT/post-report.json"
node -e "const r=require(process.env.OUT+'/post-report.json');console.log(r.summary,'mergeGroups',r.mergeGroups.length,'review',r.reviewGroups.length,'rowsNow',r.routingRowsBefore)"
```
Expect `mergeGroups 0`, `review 4`, `rowsNow 50`.

6b. Before/after comparison using the tool's own invariants (save as untracked `apps/integration-hub/verify-post.ts`, run, then delete):

```ts
import { readFileSync } from "node:fs";
import { verifyMergeInvariants, routingReviewRows } from "./lib/hospitality-catalogue-canonicalisation";
const load = (f: string) => JSON.parse(readFileSync(`${process.env.OUT}/${f}`, "utf8"));
const pre = load("pre.json"), post = load("post.json");
const active = (s: any) => s.items.filter((i: any) => i.record.lifecycleState !== "archived");
const rows = routingReviewRows(post);
const archivedIds = new Set(post.items.filter((i: any) => i.record.lifecycleState === "archived").map((i: any) => i.canonicalId));
console.log({
  activeItems: [active(pre).length, active(post).length],            // expect 89 -> 50
  offerings: [pre.offerings.length, post.offerings.length],          // expect equal (43)
  prices: [pre.prices.length, post.prices.length],                   // expect equal (42)
  offeringsOnArchivedItem: post.offerings.filter((o: any) => o.record.lifecycleState !== "archived" && archivedIds.has(String(o.record.hospitalityMenuItemId))).map((o: any) => o.canonicalId), // expect []
  routingLiveBefore: pre.routing.filter((r: any) => !r.supersededBy).length,  // 8
  routingLiveAfter: post.routing.filter((r: any) => !r.supersededBy).length,  // expect 8
  routingRowsPerItem: rows.length === new Set(rows.map(r => r.itemId)).size && rows.length === active(post).length, // expect true
  mergeRecords: post.merges.length,                                  // expect 39
  invariantProblems: verifyMergeInvariants(pre, post),               // expect [] (routing preserved, nothing vanished)
});
```
```bash
npx tsx verify-post.ts && rm verify-post.ts
```

6c. UI/behavioural spot checks on staging: Hub → Connections → Hospitality Menu routing shows one row per product (no `— RCoA` / `— MNK` pairs; `scopes` lists each site); the 4 review products still appear as separate rows; the MNK portal menu is unchanged; a merged product (e.g. one of the 6 repointed: `deli_sandwich_lunch`, `exotic_fruit_box`, `filled_savoury_croissant`, `large_pastries`, `mini_pastries`, `vegan_savoury_croissant`) still routes to the same CPU workstreams on a test MNK order/CPU hand-off. Audit receipts: 39 docs with ids prefixed `canonicalisation-` in `integrationHubGovernanceAudit`.

## 7. Rollback / recovery

Nothing is deleted: archived Items keep their record and ID, source routing is kept with `supersededBy`, merges are recorded, each group has an audit receipt.

* **Single group:** set the archived Item `lifecycleState` back to `active`; repoint the moved Offerings' `hospitalityMenuItemId` to the original Item (listed in the merge record/audit receipt); delete any `inheritedFrom` routing copy on the survivor; clear `supersededBy` on the source routing record; delete its `integrationHubHospitalityMenuItemMerges` record.
* **Full:** restore the step 4 export, then re-run step 1 and confirm the report matches `$OUT/report.json` (same `planHash`, 39 groups).
* **Abort criteria:** any non-empty `invariantProblems`, any `offeringsOnArchivedItem`, offering/price count change, or a lost routing decision → stop, restore, report.
* No Firestore index, rules, app deployment or secret change is involved. Cost: one-off maintenance reads (full-catalogue report + per-group bounded reads); no recurring reads added.
