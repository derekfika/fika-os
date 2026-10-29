# Munich RE Hospitality onboarding: catalogue, contextual minimums, locations

Written 2026-10-29 on `origin/main` 45c60817. The live Munich RE Microsoft "Hospitality Booking Form (2026)" is the authority; the brochure is reference only. The form was inspected read-only (no response submitted).

## 1. Audit findings

* Munich RE was a **development copy of the CFC brochure** (36 rows) served from a local snapshot (`/api/reference-data?site=munich-re`) with Hub price authority in `trustedPublicOrder` and `provider = munich-re-generic-brochure`. None of it matched the form.
* Gallagher already caps product minimums at 5 (`capGallagherMinimum`, site-agnostic, tested). Detection is a normalised company name equal to `gallagher` (so `Gallagher Re` does not match) or a `@redington.co.uk` requester.
* Rooms are free text (`roomOrArea` / `floorLevel` / `deliveryPoint`); Munich RE "operational areas" are coffee-service points, not meeting rooms. No room/collection model existed.
* PR #81 added CFC/Munich RE sandwich-mapping tests that asserted a Munich RE minimum of 8; they now assert 5.
* CFC remains a local brochure snapshot with no governed mapping (see section 5).

## 2. Form inventory and mapping (`munich-re-form-catalogue.ts`)

28 priced products; the Flex water has no price on the form and is not orderable. Classification (`munichReFormMapping`): 1 existing-direct (Rice Paper Rolls), 2 existing-with-MR-config (Canned Soft Drinks £2.50 vs £1.75; Salad & Protein Platter £70 = 5 x £14 canonical per person), 8 ambiguous, 17 missing. Each row names its canonical candidate and why it is not a clean match. Nothing in Firestore was created or edited: promotion must go through Hub catalogue admin with routing decisions. The old CFC-derived rows are retained as `archived` (served to no one, refused for new bookings, not deleted).

## 3. Contextual minimum (`hospitality-site-minimums.ts`)

`effectiveProductMinimum(catalogueMinimum, { gallagher, siteId })`: result = lowest applicable of (a) catalogue minimum, (b) Gallagher cap 5 (unchanged), (c) site override, which applies **only when the catalogue minimum is exactly the standard 8**, so fixed packs and genuine minimums (12, 20, 30) are untouched. Overrides live in `SITE_STANDARD_MINIMUM_OVERRIDES` (`munich-re: 5`). The catalogue Item stays 8. Wired into `catalogueMinimums`/`validateCatalogueRules` (shared, browser + Hub) and the Hub `buildMnkCanonicalBooking` and `trustedPublicOrder` paths, so server order creation matches display. Amendments re-enter the same Hub ingestion. Persisted quantity is the ordered quantity.

| Context | Minimum (standard-8 items) |
| --- | --- |
| One Angel Court, ordinary | 8 |
| One Angel Court, Gallagher | 5 |
| Munich RE, all | 5 |
| Other sites | 8 |

## 4. Locations (`munich-re-locations.ts`)

Seven rooms (Acacia 20, Aloe 5, Ginko 5, Ironbark 14, Avon 16, Amazon 16, Flex = Avon + Amazon, capacity unconfirmed) and three collection points (Level 2 Pantry, Level 3 Reception, Level 5 Cafe), as distinct kinds. **Portal wiring is not done** (section 6).

## 5. CFC boundary

Not changed. Outstanding: CFC has no governed provider mappings in Hub (`cfc-hospitality-brochure`), its 36-row snapshot is the unreviewed brochure conversion, and the portal still falls back to the local snapshot. The mapping classification pattern and `munichReFormMapping` shape are reusable for CFC.

## 6. Not done / needs a decision

1. **Hospitality portal UI** (`apps/hospitality-booking`) is leased to `hospitality-rotations-dashboard-ui`. Pending there: pass `siteId` into `minimumQuantityFor`/`catalogueMinimums`/`validateCatalogueRules` in `BookingPortal.tsx`; a Munich RE location selector writing `roomOrArea` (rooms) or `deliveryPoint` (collection points) from `MUNICH_RE_LOCATIONS`; update `tests/mnk-contract.test.ts:140` (source path assertion) for the form catalogue. Until then the UI shows 8 while the server accepts 5 (never rejects a valid order).
2. Owner decisions: Flex capacity; which canonical Items map for the 8 ambiguous rows (notably Deli Sandwich Platter £50 vs £9 pp); whether the per-person canonical items are the intended "standard 8" Munich RE products given the form sells platters; Flex water price; VAT treatment; the 2% service fee; option quantities per variety (A-F) which the snapshot models as multi-select until governed `quantities` choices exist.
3. Governed Hub catalogue promotion in Firestore (staging first) for the 17 missing and mapped rows. Do not run `promote-local-portal-menu-items.ts` against shared data for Munich RE (it would create MR-only copies).
4. Hospitality -> CPU -> Logistics end-to-end, amend/cancel propagation and staging UAT were **not run**.
