# Dry run for pre-rebuild Studio menus

This planner covers legacy Studio-authored menus and dishes. The [Hub Rotations planner](../../../tools/hospitality-menu-studio-migration/README.md) covers a different source. Both accept only a supplied local export.

From the Studio app with locked dependencies installed, run:

```powershell
npm exec --no -- tsx scripts/plan-authored-menu-migration.ts path-to-export.json
```

The planner reads one UTF-8 JSON file up to 32 MiB and prints a deterministic report. Exit code 0 means `REVIEW_REQUIRED`, 2 means at least one conversion blocker, and 65 means the input failed schema or archive checks. Every report sets `executable` and `activatable` to false.

## Export fields

| Field | Required evidence |
|---|---|
| `contract`, `projectId`, `capturedAt` | `fika.studio-authored-menu-export.v1`, the exact authorised demo or staging project and the UTC capture time. |
| `catalogueHash`, `catalogueItems` | The current verified Hub package hash, and stable eligible Item IDs with a separately reviewed `presentation` where known. |
| `menus`, `dishes` | Entries of `{ item, archiveHash }`. Use decoded saved records from Studio's legacy menu and dish collections, with their exact version. Compare each record to its immutable archive at capture. Hash the decoded archive as SHA-256 of Studio canonical JSON, with sorted object keys and preserved array order. |
| `existingProductDraftIds` | Product Item IDs already present in the target inventory. Supply an empty array only if captured evidence establishes that none exist. |

Capture a consistent authorised snapshot and keep it offline. The planner checks supplied identity and archive hashes. It cannot verify that the export covers every source record or that nothing changed after capture. It never contacts Firebase, copies customer records or writes an import payload.

The report preserves exact menu and section identity, original date windows, rotation order, blank weeks and exact dish revisions. It reports ambiguous mappings, an existing product draft, missing archive evidence, unresolved selection rules or a collection that needs its own activation review. Intended draft configuration carries no prices, signatures, kitchen copy or publication evidence. The original published bytes and historical bookings remain the source of truth for their periods. Review dates and valid Hub/CPU evidence separately before any approved activation or cutover.
