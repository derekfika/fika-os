# FIKA OS UAT report — queue pass since the 31 Oct handback

**Date:** 31 Oct 2026 · **Lane:** Haiku UAT and issue-closure (single dispatcher) · **Environment:** staging only, read-only or non-submitting · **Production:** untouched.
**Baseline:** `origin/main` `b913fc3e` (includes handback PR #203).

## Headline
- **No issue has a fully evidenced PASS this pass. Nothing has been closed.**
- Priority defect for implementation: **#155** (salad slot mapping missing).
- Design defect confirmed against owner intent: **#103** (desktop access still requires van grants).

## Resource checkpoints (#190)
| Time (31 Oct) | Battery | Power | Usage |
|---|---|---|---|
| Start of pass | 51% | AC, charging | UNKNOWN (no telemetry exposed) |
| Mid pass | 51% | AC | UNKNOWN |
| Latest | 55% | AC | UNKNOWN |

## Serving inventory (read-only, App Hosting traffic and build source)
| Backend | Build | Source | Notes |
|---|---|---|---|
| Hub | build-2026-10-31-002 | f2afded5 (main at that time) | READY, 100% |
| Hospitality | build-2026-10-31-002 | f2afded5 | READY, 100% |
| Menu Planning | build-2026-10-30-002 | f03ed05a | READY, 100%. Not serving #153 (PR #192). |
| CPU | build-2026-10-31-001 | c038fbce | READY, 100% |
| Logistics | build-2026-10-31-001 | c038fbce | READY, 100% |
| Delivered-In | build-2026-10-30-001 | 8512119e | READY, 100% |

Rollout SUCCEEDED state was not re-read per build.

## Results by issue

### #174 Hospitality guest minimums — PARTIAL, open
- **One Angel Court:** guest 0 gives "Enter at least 1 guest." on blur; 1 accepted.
- **One Angel Court, Plan step:** Deli Style Sandwich Lunch carries catalogue `defaultMinimumGuests` 8 and `defaultMinimumQuantity` 8. Guest field shows "Enter at least 8 guests." with the value kept at 1. 7 keeps the error; 8 clears it. Quantity minimum "8 boxes" applied to the line.
- **RCoA All Day, event level: GAP.** Blank or 0 in "Usual number of guests" gives no guest message, and the step progresses once other required fields are valid.
- **RCoA All Day, service level: PASS.** Blank service guests block with "Enter at least 1 guest."
- **Open:** RCoA event-level message; whether the item flag should appear immediately on Plan; owner check that the Deli 8-guest value is intended; RCoA standard, MNK, CFC; multi-service minima; server rejection (not run, needs submission).
- **Owner check:** the Deli item's guest minimum equals its quantity minimum. The issue says quantity minimums must not become guest minimums.

### #157 Hospitality dashboard filtering — PARTIAL, open (One Angel Court)
- **PASS:** search ("DEMO" → 1 of 3; "zzqq" → 0 of 3 with empty state); sort (latest first: 12, 11, 10 Nov); status New (1 of 3), Completed (0 with empty state); date boundaries (11–11 → 1; 12–12 → 1; 13–30 → 0); reset; counters follow filtered results.
- **GAP:** status options are New, Quoted, Completed only. The 10 Nov booking "Sent to CPU" cannot be filtered.
- **GAP:** inverted date range (12→10) gives empty results with no message.
- **Not run:** Run sheet consistency, site isolation, multi-status combinations.

### #155 Menu picker filters and salad slots — PRIORITY DEFECT, open
- All salad rows labelled generically "Salad"; no SALAD 1–6 labels.
- Monday salad picker: 0 dishes, "No dish in this slot has tags yet."
- Owner gate (no completion until SALAD 1–6 mapping works) not met.
- Reproduction posted on #155. **No code change in this lane.**

### #180 Ordered pax vs guests — PARTIAL, open
- MNK UAT test room booking (28 Oct): Day card "15 pax"; detail "What to produce — Customer ordered quantities — 15 pax"; no piece count on that screen.
- "Event guests: 6" is a separate booking field. Not confirmed as a defect.
- Totals (week of 2 Nov): "Deli Style Sandwich Lunch — 26 — Per person", units kept separate.
- **Not checked:** Run sheet, printable sheets, packing checklist, Queue, mixed-unit lines.
- **Owner to confirm:** 15 pax is the intended customer quantity for this test booking.

### #156 CPU site filters — PARTIAL, open
- **PASS:** 7-site list with counts; multi-select (Commerzbank + Haleon → "2 of 7 sites", chips); Week shows 7 orders for selected sites (3 + 4).
- **Totals:** selected-site count 7 matches. **Discrepancy:** all-sites count is 24 in Week and 23 in Totals for the same Mon–Fri range. Likely the cancelled 29 Oct booking, not confirmed.
- **Not tested:** Run sheet parity (owner clarification 30 Oct), reset, filter persistence.

### #178 Hub bulk category — PARTIAL, open
- **Automated:** `hospitality-catalogue-bulk.test.ts` and `hospitality-catalogue-bulk-route.test.ts`: 10 of 10 pass.
- **Staging:** Hub bulk editor not reached. Hub tile opens a blocked new tab. The catalogue is a Hub view ("Hospitality Catalogue", `apps/integration-hub/app/ui/Hub.tsx`), reachable from the Hub navigation, which was not tried. No edit made.

### #103 Logistics desktop permissions — FAIL against intended design, open
- **Intended (owner-confirmed):** van PIN gives anyone with the PIN that van's mobile driver workflow (no login); desktop access is governed by the AUTHMOD Logistics app permission, with no van grants.
- **Current `main`:** desktop vehicle access still requires a `logistics.vehicle` grant per van (`apps/logistics/docs/batch1-authority-drivers.md`: app admission alone does not grant vehicle access).
- **Automated tests pass** but test the grant-based model, so they do not prove the intended behaviour: Hub 38/38; Logistics access regression 93/93; resource authority 55/55; driver execution 61/61; mobile PIN access 12/12.
- **Correction posted** on #103 (an earlier comment wrongly implied tests showed app permission was enough).
- **Next step:** implementation change in Hub admission and Logistics desktop vehicle scope, separate PR, PIN path unchanged. Then staging retest with a staff desktop account that has app permission and no van grants.

### #95 Logistics checkbox label — PARTIAL, open
- **Automated:** `mobile-ui-contract.test.ts` 8 of 8 pass (driver label contract).
- **Staging visual:** needs a run with a loaded delivery, which requires dispatch. Not done.

### Not run this pass
#142 (run sheet PDF preview; physical print owner-only), #186 (keyboard and touch checks), #154 (Dish modal), #152 (authenticated tag count re-check), #153 (NOT DEPLOYED: PR #192 not in Menu serving build).

## Staging provenance and state
- No bookings created or amended. No submissions. Forms filled with test values and not submitted.
- RCoA "Progress saved" may have created a server-side draft. Admin to confirm.
- Synthetic UAT records remain on staging: three CPU work items "Uat Only — Not For Service — Synthetic Logistics Routing Marker" (28 Oct), a cancelled One Angel Court test booking (29 Oct), and "MNK · UAT test room (disposable)" (28 Oct).
- #181 (side-effect isolation) remains open; write-path checks remain blocked.
- No production change. No deployment. No IAM or AUTHMOD change.

## Environment note
- UAT worktree moved to detached `origin/main`. Dependencies installed under `apps/integration-hub` and `apps/logistics` for running tests only. No commits from that worktree.

## Owner decisions needed
1. #155: priority implementation (SALAD 1–6 mapping).
2. #103: approve implementation of desktop app-permission access without van grants.
3. #174: confirm the Deli item guest minimum of 8 is intended.
4. #180: confirm 15 pax is the intended customer quantity for the test booking.
5. Staging test identity for the #103 retest (existing staff desktop account with app permission and no van grants), or agreement to create one.
6. Whether to clean up synthetic records and confirm the RCoA draft.

## Restart queue
1. #156: explain 24 vs 23; Run sheet parity; reset.
2. #180: Run sheet and printouts; mixed-unit cases.
3. #174: RCoA event-level message; RCoA standard, MNK, CFC.
4. #157: "Sent to CPU" status; inverted range message; Run sheet consistency; site isolation.
5. #178: Hub navigation to the bulk editor; 11-Wine preview (no apply).
6. #142: PDF preview (no print).
7. #186: keyboard and touch.
8. #103: after implementation PR, staging retest.
9. #95: staging visual when a loaded run exists or on owner-approved fixture.
10. #152, #154: re-verify and open-modal checks.
