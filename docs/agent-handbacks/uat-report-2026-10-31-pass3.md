# FIKA OS UAT report — pass 3 (31 Oct 2026)

**Lane:** independent QA / UAT (not dispatcher, not developer). **Environment:** staging only; read-only or non-submitting. **Production:** untouched.
**Baseline:** `origin/main` at pass start `b913fc3e` (PR #203 merged). PR #204 (pass 2 report) open, not merged.
**Stop reason:** pass stopped with the eligible queue partly done. Battery 60% on AC, so no resource boundary was reached. Remaining items are listed below.

## Resource checkpoints (#190)
| Point | Battery | Power | Usage |
|---|---|---|---|
| Start | 58% | AC | UNKNOWN |
| Mid | 58% | AC | UNKNOWN |
| Latest | 60% | AC | UNKNOWN |

## Live serving inventory (App Hosting, read-only)
All six backends: build READY, rollout SUCCEEDED, single split at 100%, automatic rollouts disabled. Same as the 31 Oct inventory.

| Backend | Build | Serving source | Main has newer app code? |
|---|---|---|---|
| Hub | build-2026-10-31-002 | f2afded5 | No (apps and packages identical to main) |
| Hospitality | build-2026-10-31-002 | f2afded5 | No |
| Menu Planning | build-2026-10-30-002 | f03ed05a | **Yes**: `9242c681` "Menu Planning: rank dish tag suggestions" (#192) is on main, not serving |
| CPU | build-2026-10-31-001 | c038fbce | No |
| Logistics | build-2026-10-31-001 | c038fbce | No |
| Delivered-In | build-2026-10-30-001 | 8512119e | not compared this pass |

Consequence: **#153 is NOT DEPLOYED.** Merged code does not count as deployed functionality.

## Results

### #156 CPU site filters — PARTIAL, open
- **Count discrepancy explained (Week 24 vs Totals 23, Mon 26 – Fri 30 Oct):** the difference is the cancelled One Angel Court test booking (29 Oct, status "Cancelled", "UAT TEST ONLY — DO NOT PREPARE OR DISPATCH").
  - Week, One Angel Court filter: **6** orders (includes the cancelled booking).
  - Totals, One Angel Court filter: **5** orders.
  - Totals excludes cancelled orders; Week counts them. Both views label the cancelled record differently.
- **Defect to decide (owner):** Week's "24 production orders" counts a cancelled order with no label in the count. Either exclude cancelled from the count or say "incl. 1 cancelled". Not a correctness defect in Totals.
- **Run Sheet:**
  - With an inverted date range (27 Oct to 26 Oct) the page shows "No production orders match these filters. 2 production orders are hidden by them." This is correct for an inverted range but the message does not say the range is invalid.
  - With a valid range (27 Oct to 27 Oct) and One Angel Court selected, the run sheet lists One Angel Court items and reports "Showing 5 production orders for the selected sites. All sites: 23 production orders."
  - **Open:** the all-sites figure of 23 is the week total, not the 27 Oct total. Confirm whether run-sheet counts are meant to be day-scoped.
  - "Reset filters" also reset the run-sheet date range to 26 Oct. This is not documented and should be confirmed as intended.
- **Not tested:** Day view site filter; filter persistence across all views.

### #180 Customer-ordered quantities — PARTIAL, open
- Run sheet (28 Oct, One Angel Court and MNK filter): items show as "10 portion", with "0/4 dishes packed" checklists. These are published-menu portions, not customer pax, so they do not test #180 directly.
- Earlier pass: MNK test room detail shows "15 pax" customer ordered with no piece count; "Event guests: 6" is separate.
- **Not verified:** pax on Run sheet for the MNK test booking itself (site filter did not isolate MNK in this pass), printable sheet, Queue, mixed-unit lines (trays, boxes).
- **Owner to confirm:** 15 pax is the intended ordered quantity for the test booking.

### #142 A4 run sheet print preview — NOT TESTED
- The "Print run sheets" control exists. Opening the print preview may call the browser print function, so it was not opened. No print performed. Needs a preview-only method approved by the owner.

### #155 Menu salad slots — FAIL (unchanged), open, priority
- Re-checked on Menu staging (serving `f03ed05a`): no "SALAD 1–6" labels (rows still labelled "Salad"). Monday salad picker: "Showing salad dishes only", "0 dishes", "No dishes are available for this slot yet."
- No commit on main since `f03ed05a` touches this slot mapping (only `9242c681`, tag ranking, not serving).

### #153 Menu tag suggestions — NOT DEPLOYED, open
- Merged code `9242c681` is not in serving `f03ed05a`. No browser verification possible until a governed Menu staging deploy of a build containing it. Owner or Codex dispatcher to deploy; QA does not deploy.

### Not run this pass (carried to the restart queue)
- **#174:** RCoA All Day event-level blank/0 guest check was done in pass 2 (gap recorded). RCoA standard, MNK, CFC and multi-service minima not run.
- **#157:** Sent to CPU status and inverted-range message were checked in pass 2 (gap recorded). Not re-run; serving Hospitality unchanged since then.
- **#178:** Hub navigation to the Hospitality Catalogue bulk editor not tried in this pass. Automated 10/10 from pass 2.
- **#119:** Floor/Room field inspection not performed.
- **#186:** keyboard, Escape/focus, touch not run.
- **#152 / #154:** tag registry count and Create/Edit modal (read-only) not run.
- **#103:** cannot be retested. Corrected implementation (desktop without van grants) is not deployed. Desktop staff retest waits for that deploy.
- **#95:** no loaded-run visual; automated 8/8 from pass 2 only.

## Staging state
- No bookings created or amended. No submissions. No menu publication or withdrawal. No email, Calendar or Drive writes. No IAM or AUTHMOD change. No deployments. No physical printing.
- Filters and date ranges were changed on CPU and Menu views (view state only).
- Synthetic records still on staging: CPU work items "Uat Only — Not For Service — Synthetic Logistics Routing Marker" (28 Oct), cancelled One Angel Court test booking (29 Oct), "MNK · UAT test room (disposable)" (28 Oct). Cleanup needs owner approval and verified isolation (#181).
- RCoA "Progress saved" (pass 2) may have created a server-side draft. Admin to confirm.

## Decisions needed from the owner
1. #156: cancelled orders in Week count — exclude, or label "incl. cancelled"?
2. #156: is run-sheet count meant to be day-scoped? Should "Reset filters" keep the date?
3. #180: confirm 15 pax customer ordered for the MNK test booking.
4. #142: approve a preview-only method (no print) or accept owner-only print checks.
5. #155: priority implementation of SALAD 1–6 mapping.
6. #153: request a governed Menu staging deploy of `9242c681`.
7. #103: implementation of desktop access without van grants, then deploy, then desktop retest.
8. Synthetic record cleanup and RCoA draft confirmation (after #181 isolation).

## Restart queue
1. #156: Day view site filter; filter persistence; Run sheet count scope (after owner answer).
2. #180: MNK run-sheet pax, printable sheet, Queue, mixed-unit lines.
3. #174: RCoA standard, MNK, CFC minima; multi-service.
4. #157: re-run Sent to CPU and inverted-range checks on current build.
5. #178: Hub navigation to bulk editor; 11-wine preview without applying.
6. #119: Floor/Room fields per site.
7. #186: keyboard, Escape/focus, touch.
8. #152/#154: tag count and read-only modal open.
9. #153: after governed Menu deploy of `9242c681`.
10. #103: after corrected implementation deploy.
11. #95: loaded-run visual or owner fixture.
12. #142: preview-only check after owner decision.
