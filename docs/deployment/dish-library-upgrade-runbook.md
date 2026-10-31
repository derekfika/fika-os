# Dish Library upgrade runbook (replace a library with a reviewed, tagged export)

Status: staging rehearsal done 30 Oct 2026. **Production has not been upgraded.** `scripts/replace-dish-library.ts` accepts only the staging project; running the same workflow in production needs a separate owner approval and a reviewed change that lifts that guard.

## What the upgrade does

1. Reads the target environment's current dish documents (`fikaMenuPlanningCatalogue`, `kind == "dish"`), the shared tag registry and the catalogue manifest.
2. Builds the new library from a reviewed export (original + archived JSON) and applies the approved tag assignments (tags only from the shared registry, a salad slot only on Salad dishes). Dish IDs, names, categories, aliases and allergen evidence are never changed. **No dishes are merged.**
3. Archives every current document first (raw copy under `fikaMenuPlanningCatalogueArchives/<archiveId>/dishes/*`, a metadata document with a content digest, and a local JSON backup). It stops if the archive count does not match.
4. Writes the new library through the app's own catalogue writer in chunks, so the manifest revision and source hash advance consistently. Old dishes that are not in the new library are kept as **archived** (never deleted), so IDs still resolve.
5. Re-reads Firestore and checks every dish exists, tags match and archive flags match.

## Pre-flight checks (all must be clean; the script blocks otherwise)

- **Published menus.** Every dish used by a currently published (not withdrawn) day on or after `--from-date` (default: today, Europe/London) must remain an **active** dish with the **same ID** after the upgrade. A dish that would be missing, archived, or only reachable because another dish now carries its name or alias counts as removed or merged and blocks the run. Before a production upgrade, set `--from-date` to the **first day of next week's published menu** and read the `publishedCheck` block of the dry run: `problems` must be empty. An old-only dish that a published menu still uses is retained active and unchanged and is listed under `retainedForPublished`.
- **Name collisions.** No two active dishes may share a name (the catalogue writer rejects it); resolve in the source export, do not merge here.
- **Unexpected changes.** Only `tagIds`, a Salad's `subcategory`, an audit line, the revision and the archive flag may differ from the source dish.
- **Tags.** The tag registry in the target environment must already contain the tags (the 28 approved tags were seeded in staging only). Words with no registry tag are skipped and counted, never invented.

## Procedure

1. Owner approval for the target environment (production needs an explicit, written approval).
2. Confirm the export, the assignments file and their hashes; confirm no concurrent catalogue writer or publication is running.
3. Dry run and review the full report (counts, `publishedCheck`, `nameCollisions`, `unexpectedFieldChanges`).
4. Execute. Keep the printed report, the archive ID and the backup file.
5. Verify: counts, `docsAfter == expected`, zero mismatches, manifest revision advanced, then load the Dish Library and Week Planner as an authorised user (the derived catalogue read package rebuilds on first read when its version no longer matches the manifest) and spot-check next week's published menu and a Salad slot.
6. Re-run the published-menu check after the upgrade (a dry run is enough).

## Rollback

The raw pre-upgrade documents are in the archive collection and in the backup JSON. Restoring is a catalogue write of those records (a restore script is not part of this change; do not hand-edit documents). Because the upgrade never deletes or renames a dish, an unwanted tag assignment can also be corrected by amending `tagIds` through the normal edit path.

## Staging rehearsal (30 Oct 2026, project `fika-os-dev`)

- Source: production export revision 160 (358 active + 184 archived) plus the 29 Oct Tag Rescan and 30 Oct Salad Slot Audit (354 tagged dishes; 3 Low-confidence suspected test dishes skipped).
- Result: 402 → 545 documents; 399 replaced, 143 added, 2 archived, 1 retained for a published synthetic UAT week; 272 dishes carry tags, 91 salads carry a slot; manifest revision 13 → 17; archive `upgrade-2026-10-30` holds the 402 original documents. Published-menu check: 11 published days, 15 dish references, no problems.
- Observed: the script ran outside the hosted app, so the derived catalogue package reported "snapshot storage is not configured" (status failed); the authoritative dishes and manifest are correct and the app rebuilds the package on the next read.
