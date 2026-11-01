# Dish Library V2 — frozen approved-proposal inputs (issue #151)

These files are **versioned evidence**, not runtime data. They are the frozen output of the read-only V2 proposal
(Sonnet #151 report, 1 Nov 2026) and are read only by `lib/catalogue-cutover` / `scripts/dish-library-v2/cutover.ts`.
Nothing in the application imports them. They carry **no approval**: the owner decisions listed in `RUNBOOK.md`
(EX-004 merge, the eight exclusions, the nine rolling IDs, subtypes) are still required before any write.

| File | sha256 |
| --- | --- |
| `v2-survivors-proposed.json` (353 active survivors, ids + tags) | `ad62f7f369e78e2eda5976ee62d18b3f1dd32a437709531c05d7f567af860599` |
| `identity-mappings-proposed.json` (546 ids: 353 keep / 192 archive / 1 merge; nine rolling IDs) | `81e998f7d1b29ee0f01a0f53d6fee988d61ea4b6ffca849d0e7b0cce717e2563` |
| `dry-run-replacement-manifest.json` (counts, assumptions, blockers; `executionAllowed: false`) | `bcdee0ef8b24099e784923115112823ecd37b1fdc72fdd1ec86d6617f72768b0` |
| `duplicate-name-allowlist.json` (empty allow-list of normalised names that may collide among active survivors; part of the plan hash) | n/a (new; not part of the frozen proposal) |
| `references-published-v4-2026-11-02.json` (derived: the 82 distinct dish ids of the 2–6 Nov v4 publication; 101 entries, 6570 portions) | derived from `v4days.json`; regenerate and re-hash before use |

The first three hashes equal the `SHA256SUMS` recorded when the proposal was frozen. The tool records the sha256 of the
survivors and mappings files in every plan hash, so editing a file changes the plan and invalidates any approval.

## What is *not* in this directory

* The reviewed V2 **records** (full dish documents with tags and salad subtypes). The survivors file lists ids only; the
  records come from the 30 Oct staging upgrade export (`catalogue-dishes.json`, rev 18) and are passed with
  `--v2-records`. The plan refuses any survivor whose record differs from the live V1 record outside
  `tagIds` / `subcategory` / `revision` / `audit`.
* Any production or staging data. Production is never read by these files.
* References from 9 Nov onward — not yet checked (see the runbook blockers).

Shape notes: the mappings file is informal. The tool treats `action: "merge"` + `toId` as the only successor source
(an `archive` entry with a `toId` is refused unless it also carries `verifiedTarget: true`; none do). Archived ids
without a verified target stay **unresolved**; `reviewHintOnly` entries are never mappings.
