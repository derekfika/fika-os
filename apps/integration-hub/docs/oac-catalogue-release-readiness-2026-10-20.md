# OAC catalogue: final validation and release readiness (2026-10-20)

Recommendation: **NO-GO for production release today.** Code and plan are validated locally; three gates are open: VAT approval, live-source revalidation (credentials expired) and staging/browser UAT (not possible against unreleased code). No production mutation, publication, push, merge, deploy or migration was done.

## 1. Implementation assumptions resolved

* Baps and fresh juice: numeric allocation across the approved varieties; the allocations must sum exactly to the ordered quantity (unchanged, tested).
* Mini Traybake Bites: four brochure varieties kept as an *assortment description*; no choice control. Existing nut / nut-free Traybake Box Items are untouched and never referenced (tested).
* Classic Buffet: £18 pp, product quantity min 50 and event guest floor 50; 49 of either fails, Gallagher relaxes only the product quantity (tested).
* **VAT (unresolved, held for approval).** Findings:
  * All 43 active live Prices carry 20%, including food, drinks and a UAT test category. There is no governed product tax classification and no zero-rate product.
  * The only code default is `DEFAULT_VAT_RATE = 0.2`, applied when a command omits `vatRate`.
  * `quote-engine.ts` computes VAT from the dashboard-level `vatRate` (0.2 for `angel-court-hospitality` and `rcoa-hospitality`); a Price's own `vatRate` does not drive quote totals. So per-product VAT on a Price is currently informational for quotes.
  * Therefore the plan no longer writes 20% on new Items. Overrides on existing Items omit `vatRate` and inherit the Item's governed rate. The 33 new *priced* Items (all creates except the quote-only Celebration Cake) are now **held** (`taxApprovalRequired`) and carry no VAT rate until the operator approves one. Approval is supplied explicitly: `prepare-oac-catalogue-sync.ts EVIDENCE OUT 0.2` (any 0..1 rate) regenerates the plan with that rate and no hold, producing a new plan hash.
  * Not decided here (tax advice is out of scope): whether any item (for example cold/hot food, wine, soft drinks) should differ from 20%, and whether the dashboard-level quote rate should respect per-product rates.

## 2. Emulator tests (isolated Firestore emulator, loopback 8292, project `demo-fika-os`, sequential)

* Catalogue suites (admin, bulk, defaults, sparse, OAC engineering) and Angel Court ingestion: 30/30 pass. OAC migration persistence: 5/5 pass on a clean emulator with `FIKA_RUNTIME_MODE=local` (5 fail without that required variable; 4 fail when run after other suites, see below).
* **Plan rehearsal on production-shaped data** (second emulator, 8293): seeded 432 documents from the 06:18 UTC live evidence, ran all 46 planned commands through the real governed transactions: 46/46 succeeded; effective catalogue compared before and after for all 23 OPLOCs on 2026-10-26 and 2026-12-01: **0 changes at any non-OAC site**; replaying every create produced no new documents (408 before and after) and no errors; OAC offerings 39 → 74 (the 34 creates, plus Loaf Cake, which was unpriced and so not bookable before and is now a visible quote-only offering). Script: `scripts/oac-plan-rehearsal.ts` (refuses anything but a loopback emulator with a `demo-*` project). Report: `engineering-plan-v3-approved\emulator-rehearsal-report.json`.
* Both emulators were stopped afterwards. Nothing was force-killed mid-test and no unsupported test flags were used (`--test-concurrency=1` only).

## 3. Full Hub suite and the previous 19 failures

Sequential run against the emulator: 875 tests, 829 pass, 17 fail, 29 skipped. The earlier 19 were mostly emulator timeouts; those now run. Classification of the 17:

| Failures | Class | Evidence |
|---|---|---|
| 11 (ADDR-001 spec file missing; Delivered-In access ×3; Logistics admission trace; cancel-saves-refresh; canonical boundary; completeness register; service-and-allocation confirm; Service Definition GET ×2) | **Pre-existing, unrelated** | Fail identically on a pristine extract of this branch's `origin/main` base (755a7f87) with none of this work, and in the original checkout. Several are stale source-text assertions (for example `window.confirm` replaced by a modal). None touch files in this diff. |
| 1 `booking-email-firestore` "canonical transitions…" | **Pre-existing** | Fails on the pristine extract too (with the migration hook reverted as well). |
| 1 CSRF cookie test | **Environment** | Fails only while `FIRESTORE_EMULATOR_HOST` is set; passes without it. |
| 4 `oac-migration-persistence` in the full run | **Test isolation** | Assert `fikaBookingNotifications` is empty; earlier suites leave rows in the shared emulator. Pass 5/5 on a cleared emulator. Migration work, not catalogue. |
| Skipped 29 | Skipped | Tests the suite itself skips (opt-in flags or conditions not set here). I did not enumerate or enable them, and they are not counted as passing. |

No failure was introduced by the catalogue work. One real regression found earlier (stale OAC compatibility test) was fixed.

## 4. Typechecks, builds, regressions

* Hub, Hospitality, CPU `tsc --noEmit`: pass. `next build` for Hub, Hospitality, CPU: all exit 0.
* Build-generated changes (`apps/hospitality-booking/next-env.d.ts`, `apps/shared/hospitality-quote-brand-assets.generated.ts`) were restored; none remain.
* Focused: `oac-approved-catalogue` 23/23 (adds VAT-gate, buffet and traybake tests), OAC rules/sync-plan/package/client 59 total pass; Hospitality full suite 255/255 (earlier run; unchanged since).
* `git diff --check`: clean.
* Note: `@fika/server-shared` resolves through `node_modules` to the main checkout's `packages/server-shared`, which carries the same uncommitted rules code as this worktree's copy.

## 5. Staging UAT: blocked

Specific blockers: (a) the staging apps (`hospitality-staging`, Hub, CPU) serve deployed code, and this work is uncommitted and not deployed; deploying is not authorised. (b) Staging needs a signed-in session, which I cannot create. **No browser UAT has been performed or claimed.** Local substitutes: emulator rehearsal (section 2) and unit/ingestion tests covering Gallagher vs ordinary minimums, per-variety allocation, Finger Food 12/20 guests/240 h, Summer Roll 3 platters and one flavour per platter, Breakfast Pots 3.50 / 12 (Gallagher 5), House Drinks full-guest upgrades, quote-only cakes, production conversion, OAC-only availability and package v2 / cache v3 reading. Still unverified in a browser: allocation controls, quote enquiry cards, cache v3 transition, CPU each-versus-box display, RCoA/MNK pages.

## 6. Source and plan reconciliation

* **Live re-read blocked**: authorised read-only access exists in principle (Application Default Credentials on this machine), but the stored refresh token is rejected (`invalid_grant / invalid_rapt`, reauthentication needed). A get-only reader is ready; the operator must run `gcloud auth application-default login`, after which the read, comparison and plan regeneration take minutes. Until then the source is the 06:18 UTC evidence.
* Source fingerprint (provisional): `a44bdcb7aa3b8c89c1fa877734e4ac462a81806d2ed0dca0db199255098fff91` (unchanged: nothing re-read).
* Plan hash: `81c42182051153d5036d3614a882e7bf0024de0449c6fcfa3d3e822f833638c5` (34 creates, 12 updates, 7 correct, 1 excluded; 13 commands ready, 33 held for VAT). Provisional until live revalidation and VAT approval.
* Why 26 creates / 8 updates became 34 / 12 (the old plan also had 13 "needs review" and 6 correct):
  * Creates +8: separate each-unit croissant SKU (the £60 box stays), Mini Traybake Bites and Celebration Cake (no exact live Item; nut-free/nut Traybake Boxes are distinct identities), and the five House Drinks upgrades (child Items of a new parent package).
  * Updates +4: Breakfast Pots (reuse, not a new "Yoghurt Pot Selection"), the one canonical 250ml juice Item (the three juice rows collapse to one override), Finger Food (existing Item, minimum 12 per variety) and Picnic Grazing Table (was "correct"; notice now 10 days, so it needs an override).
  * Correct 6 → 7: Picnic left the list; the two extra juice rows now count as audit-only rows covered by the juice override.
* Verification (rehearsal and tests): no duplicate canonical Items (`create-item` refuses name and provider clashes; 34/34 created), no shared default changed (the plan builder rejects default/routing/merge/archive commands; none present), every create has `allowedOplocIds=[OAC]` and an explicit reviewed route, Classic Working Lunch never created, `deli_working_lunch` → Deli Style Sandwich mapping untouched, Gallagher rules unchanged, all required prices and configurations present, VAT decisions **missing by design** (held).
* Observation for the operator: OAC still shows 39 pre-existing offerings that are not in the brochure (for example Afternoon Tea, Hot Fork Buffets, Sushi Boxes, boxed lunches). They remain bookable; removing them needs a separate per-site decision. Deli Style Sandwich keeps the shared Item guest floor of 8 alongside the new 10-unit minimum.

## 7. Source-control audit (working copy vs `origin/main` 755a7f87; the original checkout was only read)

**Catalogue work (include):** `packages/server-shared/src/hospitality-effective-offering.ts`, `hospitality-catalogue-client.ts`, `hospitality-catalogue-rules.ts` (new); Hub `lib/hospitality-catalogue-admin.ts`, `-package.ts`, `-read-model.ts`, `hospitality-price-trust.ts`, `mnk-booking-catalogue.ts`, `quote-engine.ts` (choice labels), `schemas.ts`, `app/api/hospitality-catalogue/route.ts`, `lib/oac-approved-catalogue.ts`, `lib/oac-catalogue-sync-plan.ts`, `scripts/prepare-oac-catalogue-sync.ts`, `scripts/oac-plan-rehearsal.ts`; Hospitality `app/ui/BookingPortal.tsx`, `lib/hospitality-portal-catalogue.ts`, `lib/mnk-contract.ts`, `tests/site-branding.test.ts`, `tests/oac-catalogue-rules.test.ts` (new); CPU `HospitalityProductionDetail.tsx`, `ProductionOrderDetail.tsx`; tests `oac-approved-catalogue`, `oac-catalogue-rules`, `oac-catalogue-sync-plan`, `oac-catalogue-engineering.emulator`, `hospitality-catalogue-client`, `-package`, `hospitality-booking-service` (OAC fail-closed test); docs `oac-catalogue-final-plan`, `oac-catalogue-release-readiness`, `docs/deployment/oac-catalogue-engineering-2026-10-20.md`.

**Migration work (exclude):** `apps/shared/hospitality-legacy-migration.ts`, `lib/oac-booking-migration.ts`, `oac-booking-migration-local-store.ts`, `scripts/oac-migration-dry-run.ts`, `tests/oac-booking-migration.test.ts`, `oac-migration-fixtures.ts`, `oac-migration-persistence.emulator.test.ts`, `docs/deployment/oac-migration-windows-2026-10-19.md`; legacy-authority hooks in `booking-email-firestore.ts`, `booking-email-outbox.ts`, `booking-group-confirmation.ts`, `booking-group-notifications.ts`, `booking-notifications.ts`, `booking-workflow.ts`, `hospitality-group-quote-workflow.ts`, `apps/hospitality-booking/lib/canonical-types.ts`.

**Mixed (needs hunk-level split):** `lib/hospitality-booking-service.ts` (catalogue minimums/conversion vs `assertLegacyBookingOperationalAuthority`), `lib/production-domain.ts` (saved production conversion vs legacy assertion), `CHANGELOG.md`.

**Unrelated / generated:** none remaining. Build artefacts were restored; `node_modules` here are junctions to the main checkout and are ignored by Git. The only branch commit is 038b8cbc (a superseded Stage A doc, since deleted in the working tree).

State: nothing from this round is committed or pushed. Dependency note for the split: the catalogue-only subset must not import `apps/shared/hospitality-legacy-migration.ts`; the mixed files each contain one or two such lines that must be left out, then Hub/Hospitality/CPU typecheck and the catalogue tests re-run on that subset before commit.

## 8. VAT decisions requiring operator approval

1. The rate for the 33 new priced products (propose 20% only if confirmed; the platform has no per-product classification).
2. Whether per-product rates should ever differ, given quotes use the dashboard rate.
3. Celebration/loaf cakes are quote-only: VAT is determined at quote time.

## 9. Gate list before a production approval request

1. Operator re-authenticates (`gcloud auth application-default login`), then: live re-read → diff against evidence → regenerate plan (with the approved VAT rate) → new plan hash.
2. Hunk-split commit of catalogue-only files; typecheck/tests on that subset; approval of the final diff.
3. Deploy Hub/Hospitality/CPU to staging and run the UAT list in section 5.
4. Production sequence and rollback as in `oac-catalogue-final-plan-2026-10-20.md`.
