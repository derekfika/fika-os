# FEAT-034 — Unified allergen workflow, explicit No Key declaration and save latency

Status: design plus the shared contract (additive). CPU, Menu Planner, Delivered-In and Hub changes are **not started**: their paths are leased to other active tasks (see "Blocked work"). Nothing here is merged or deployed.

Baseline: `origin/main` 6fdbe49b. Branch: `codex/feat-034-allergen`. Every statement below was read from that code unless marked *hypothesis* or *pending*.

## 1. Where the applications disagree (proven from code)

| Area | Current behaviour | File |
| --- | --- | --- |
| Shared contract | `enforceNoKeyExclusivity` / `deriveNoKeyAllergens` set No Key to **contains** (Yes) whenever all 14 named allergens are `clear`, and to `clear` when any named positive exists. `normaliseOperationalAllergens` always applies it, so an explicit value cannot survive normalisation. | `apps/shared/allergen-contract.ts` |
| Shared review | `confirmRow` and `reopenRow` derive No Key; the row fingerprint covers positives and notes only, so an explicit declaration cannot be part of what a chef reviewed. Semantics 2. | `apps/shared/allergen-review.ts` |
| CPU server | `strictServerAllergens` deletes any client-supplied `no_key_allergens` and re-derives it. | `cpu-production/app/api/production-plan/route.ts` |
| CPU Delivered-In matrix | No Key cell is `disabled`; `displayState` returns the derived value: `?` when named cells are unresolved, black **Yes** when a confirmed row has every named cell clear, blank when positives exist. | `cpu-production/app/ui/AllergenReviewMatrix.tsx` |
| CPU Hospitality | Cell clicks never change No Key; clicks re-derive it. Badge distinguishes Checked / Checked (legacy) / Not reviewed. | `cpu-production/app/ui/allergen-cell-state.ts` |
| CPU completeness | `completeAllergenReviewMap` excludes No Key from "unresolved" but the shared completeness check (`isCompleteOperationalAllergenMap`) requires all 15 explicit. | `cpu-production/app/lib/allergen-review-state.ts` |
| Menu Planner | Dish resolution derives No Key (`allergen-resolution.ts`). The sandwich editor treats No Key as an explicit toggle that clears every other cell (`sandwiches.ts`). Two different rules in one app. | `menu-planning/lib/*` |

### Sam's tablet display — proven vs hypothesis
- **Proven:** `?` appears only in the **No Key column** of a row that is not yet confirmed (derived state `unrecorded`). The black **Yes** appears in the No Key column of a row confirmed with all named allergens clear (derived `contains`). Named cells render blank when `unrecorded` or `clear`, `MC` for may-contain. So a blank white cell can mean "not yet confirmed" or "confirmed clear".
- **Hypothesis (needs the live row data):** which of Sam's rows were unconfirmed versus confirmed-all-clear. The data is not corrupted by this; it is presentation of a derived value.

## 2. Contract (implemented in `apps/shared/allergen-declaration.ts`)

Storage shape is unchanged (`no_key_allergens` slot in the 15-key map) so hashes, releases and consumers keep working.

- **Declaration:** `no_key_allergens = contains` means the chef declared "No key allergens". Nothing derives it.
- **Blank row** (no positives, no declaration) cannot be marked checked. It stays Unchecked.
- **Mark checked:** blank named allergens become `clear`, positives are kept, No Key = `contains` for a declaration else `clear`. Reviewer identity and time are stamped. Review semantics **3**.
- **Conflict:** declaring No Key over positives is refused (positives returned, not erased). Selecting a named allergen while declared needs an explicit acknowledgement that withdraws the declaration. A conflicting row can never be confirmed.
- **Invalidation:** the v3 fingerprint covers identity, positives, the declaration flag and the may-contain note.
- **Legacy (Rule F):** semantics-2 reviews stay valid and are reported `checked_legacy`; they are never rewritten. A stored No Key `contains` on a row without a semantics-3 review or a declaration record is **not** treated as a declaration (`storedExplicitAllergens`). Pending declarations need a server-stamped `noKeyDeclaration { declared, declaredBy, declaredAt }` row field (new, additive).
- Existing exports in `allergen-contract.ts` / `allergen-review.ts` are untouched, so CPU and Menu Planner keep working until they adopt the new module.

## 3. Data model and migration
- Additive only: review `semantics: 3`; optional `noKeyDeclaration` on a row. No migration of stored records. Historical signed matrices and releases are immutable; the matrix content hash input is unchanged.
- **Owner decision required (not made):** whether a legacy semantics-2 all-clear row should be shown as "Checked (legacy)" indefinitely or prompted for re-check on its next edit. Implemented default: shown as legacy, re-check only when edited.

## 4. Save latency — baseline

Local micro-benchmark (this machine, no network, no Firestore; 15 runs after 5 warm-ups). **Not a staging or tablet measurement.** Script: `docs/ai/FEAT-034-allergen-bench.ts`.

| Day size (orders x lines) | Rows | Whole-day request (today) | One order | One row | Server CPU per click: normalise + hash, median / worst |
| --- | --- | --- | --- | --- | --- |
| 10 x 6 | 60 | 29.7 KB | 3.0 KB | 0.54 KB | 0.44 / 1.18 ms |
| 40 x 8 | 320 | 158.2 KB | 4.0 KB | 0.54 KB | 2.12 / 2.42 ms |
| 100 x 10 | 1,000 | 492.5 KB | 4.9 KB | 0.54 KB | 5.73 / 5.86 ms |

### Confirmed from code (static)
1. **Whole-matrix saves.** Each cell change and each Mark checked in the Delivered-In matrix sends one `batch-plan` containing **every order and every line for the day** (`AllergenReviewMatrix.tsx`, `saveReview`), up to 100 operations, server-side validated per order.
2. **Serialised queue.** `startSave` chains each save behind the previous one (`inFlightSave`); rapid taps become N sequential whole-day uploads. The Saving indicator is shared, not per row.
3. **Plan-level revision.** One `expectedRevision` protects the whole plan, so two chefs on different rows of the same order conflict.
4. **Not the bottleneck (measured):** normalisation and content hashing cost at most ~6 ms per click at 1,000 rows.

### Hypotheses (unmeasured, need staging)
- Upload size on tablet mobile data dominates for large days.
- Per-order Firestore transactions and Hub order reads in `batch-plan` dominate server time.
- Cold starts on the App Hosting backend add occasional multi-second outliers.
- Re-rendering the whole matrix per tap (566-line component) may delay cell feedback.

### Pending (cloud authentication unavailable)
Initial matrix load, tap responsiveness on a tablet, save acknowledgement, authoritative refresh, signing, release and PDF generation on **staging**. Use the ALLERGEN LATENCY UAT tab; record three attempts, median and worst. Nothing here is fabricated.

## 5. Proposed save design (needs CPU lease; separate PR)
1. New `save-row` operation: one order, one row (or the changed rows), plus the row's own revision; server merges into the plan inside the existing transaction and re-validates. Keeps plan-level revision and audit.
2. Client: optimistic cell update immediately; per-row state `Unchecked → Saving → Saved | Failed (Retry)`; Saved only after the server acknowledgement; coalesce rapid edits to the same row into one request; disable signing while any row is not Saved.
3. Keep `batch-plan` for bulk actions. No change to signing, release or audit.
4. Concurrency: a stale revision returns a conflict with the server's current row; the client keeps the local edit visible and asks the chef to reapply.
Target: row acknowledgement within about two seconds on healthy staging (provisional, not an SLA).

## 6. Tests
- Done: `apps/shared/allergen-declaration.test.ts` (14 tests): blank row, explicit declaration and check, named positives, mixed, conflicts, idempotent re-check, invalidation, reopen, legacy semantics 2, sparse and contradictory maps, unattributed confirmation.
- To add with CPU/Menu leases: server route tests for `save-row`, conflicts, retries, delayed responses and navigation with unsaved edits; matrix UI tests at 375 / 390 / tablet widths; cross-app Menu Planner → Hub → CPU flow; checker and PDF gating against historical signed records.

## 7. Blocked work (other leases, not touched)
| Path | Owner of the active lease |
| --- | --- |
| `apps/cpu-production` | `cpu-deep-link-iss018-fix` (uat-20261025-1150) |
| `apps/menu-planning` | `menu-duplicate-planning` (claude-menu-duplicate) |
| `apps/delivered-in` | `iss-001-di-cache-resilience` (haiku-iss-001) |
| `apps/integration-hub` | `authmod-reference-refresh` (uat-20261025-1150) |

## 8. Rollout
Ship the shared module alone (no behaviour change) → adopt in CPU server and UI behind the semantics-3 review → Menu Planner adoption → performance PR (`save-row`) separately → Luna's staging UAT with the latency tab → production. Rollback: each PR reverts independently; stored data is additive.
