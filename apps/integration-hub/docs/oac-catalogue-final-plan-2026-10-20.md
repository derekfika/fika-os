# OAC 2026 brochure catalogue synchronisation: final approved plan (v3)

Date: 2026-10-20. Base: `origin/main` 755a7f87 plus the preserved uncommitted OAC catalogue engineering from the main checkout. Status: **plan and code ready for review. Nothing applied, published or deployed.**

Plan hash `81c42182051153d5036d3614a882e7bf0024de0449c6fcfa3d3e822f833638c5` (supersedes 49cd75f9…; 13 commands ready, 33 held for VAT approval, see the release-readiness report); source-state hash `a44bdcb7aa3b8c89c1fa877734e4ac462a81806d2ed0dca0db199255098fff91` (live evidence read 20 Oct 2026 06:18 UTC). The source must be re-read and the plan regenerated before any execution. Artifacts (outside Git): `Documents\FIKA OS Migration Evidence\OAC-Catalogue-2026-10-20\engineering-plan-v3-approved\`.

Superseded: the earlier Stage A report (local-fixture comparison) and plan v2 (41 held rows). All business holds are now closed by the approved rules; the decisions are encoded in `lib/oac-approved-catalogue.ts` and exercised by `tests/oac-approved-catalogue.test.ts`.

## Reconciliation (53 brochure rows + Classic exclusion)

| Class | Rows |
|---|---|
| CREATE (OAC-only restricted Items) | 34 |
| UPDATE OAC OVERRIDE (sparse site exception on shared Items) | 12 |
| ALREADY CORRECT (includes juice rows 10-11, covered by the row 9 override) | 7 |
| NEEDS REVIEW | 0 |
| EXCLUDE Classic Working Lunch | 1 (never created; nothing archived) |

46 governed commands: 34 `create-item` (each `restrictToSelectedOplocs:true`, `oplocIds:[OAC]`, so future sites are excluded) and 12 `set-site-override` (OAC exception only). The plan contains no `set-default-price`, `update-item`, `set-routing`, `merge-items` or archive command, and the plan builder rejects them. Blank price/minimum cells below mean "unchanged or inherited".

| # | Product | Action | Canonical ID | £ | Min qty | Routing | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Mini Pastries | ALREADY CORRECT | – | – | – | unchanged | £36 box feeds 12: already correct; CPU Hospitality unchanged. |
| 2 | Yoghurt pot selection | UPDATE OAC OVERRIDE | rcoa:breakfast_pots | 3.5 |  | unchanged (shared) |  |
| 3 | Whole fruit bowl | CREATE (OAC-only Item) | new (id from request) | 2 | 1 | cpu_hospitality |  |
| 4 | Fresh sliced fruit platter | CREATE (OAC-only Item) | new (id from request) | 20 | 1 | cpu_hospitality |  |
| 5 | Sausage or Bacon Breakfast Baps | CREATE (OAC-only Item) | new (id from request) | 3.95 | 10 | in_house | quantities ×2, ≥1 each |
| 6 | Savoury filled croissants | CREATE (OAC-only Item) | new (id from request) | 5 | 12 | cpu_hospitality | quantities ×3, ≥1 each; 1 ordered = 1 croissant |
| 7 | Bagel Box | ALREADY CORRECT | – | – | – | unchanged | £72 box of 12 halved bagels: already correct; CPU Sandwiches unchanged. |
| 8 | Soft drinks | UPDATE OAC OVERRIDE | rcoa:canned_drinks | 2 |  | unchanged (shared) | select ×4 |
| 9 | Fresh juice — Orange / Apple / Carrot, Pear & Ginger | UPDATE OAC OVERRIDE | rcoa:fresh_juice_250 |  |  | unchanged (shared) | quantities ×3, ≥1 each |
| 10 | Fresh juice — Apple | ALREADY CORRECT | – | – | – | unchanged | Covered by the single canonical 250ml Item override (key 09). |
| 11 | Fresh juice — Carrot, Pear & Ginger | ALREADY CORRECT | – | – | – | unchanged | Covered by the single canonical 250ml Item override (key 09). |
| 12 | Bottled still/sparkling water 750ml | UPDATE OAC OVERRIDE | rcoa:belu_water | 3.5 |  | unchanged (shared) |  |
| 13 | Deli Style Sandwich | UPDATE OAC OVERRIDE | mnk:deli_sandwich_lunch | 10.95 | 10 | unchanged (shared) | 1 ordered = 3 sandwich piece |
| 14 | Salad Boxes | UPDATE OAC OVERRIDE | rcoa:salad_boxes |  |  | unchanged (shared) | quantities ×4, ≥1 each |
| 15 | Exotic Fruit Box | ALREADY CORRECT | – | – | – | unchanged | £52.50 box feeds up to 20: already correct; CPU Hospitality unchanged. |
| 16 | Mini traybake bites | CREATE (OAC-only Item) | new (id from request) | 6 | 1 | cpu_hospitality |  |
| 17 | Cake slice | CREATE (OAC-only Item) | new (id from request) | 3.5 | 1 | cpu_hospitality |  |
| 18 | Celebration cake | CREATE (OAC-only Item) | new (id from request) | quote only |  | cpu_hospitality |  |
| 19 | Loaf cake | UPDATE OAC OVERRIDE | rcoa:loaf_cake | quote only |  | unchanged (shared) | notice 3d |
| 20 | FIKA Canapes | UPDATE OAC OVERRIDE | rcoa:canapes |  |  | unchanged (shared) | notice 10d |
| 21 | Bowl Food | UPDATE OAC OVERRIDE | rcoa:bowl_food |  |  | unchanged (shared) | guests ≥20; notice 10d |
| 22 | Finger Food | UPDATE OAC OVERRIDE | rcoa:finger_food |  | 12 | unchanged (shared) | guests ≥20; notice 10d; quantities ×15, ≥12 each |
| 23 | Summer Roll Platters | UPDATE OAC OVERRIDE | rcoa:rice_paper_rolls | 30 | 3 | unchanged (shared) | guests ≥20; notice 10d; quantities ×6, ≥1 each; 1 ordered = 12 roll |
| 24 | Classic Buffet | CREATE (OAC-only Item) | new (id from request) | 18 | 50 | cpu_hospitality | guests ≥50; notice 10d |
| 25 | Cheese platter | ALREADY CORRECT | – | – | – | unchanged | £75 feeds 10: already correct; CPU Hospitality unchanged. |
| 26 | Charcuterie platter | ALREADY CORRECT | – | – | – | unchanged | £75 feeds 10: already correct; CPU Hospitality unchanged. |
| 27 | Bread basket | CREATE (OAC-only Item) | new (id from request) | 15 | 1 | cpu_hospitality |  |
| 28 | Nibble bowls | CREATE (OAC-only Item) | new (id from request) | 2 | 3 | in_house | quantities ×5, ≥3 each |
| 29 | Picnic Grazing Table | UPDATE OAC OVERRIDE | rcoa:picnic_grazing_table |  |  | unchanged (shared) | notice 10d |
| 30 | Standard BBQ | CREATE (OAC-only Item) | new (id from request) | 25 | 20 | cpu_hospitality | guests ≥20; notice 10d |
| 31 | Premium BBQ | CREATE (OAC-only Item) | new (id from request) | 32.5 | 20 | cpu_hospitality | guests ≥20; notice 10d |
| 32 | Organic Macabeo, Familia Castaño, Murcia, Spain | CREATE (OAC-only Item) | new (id from request) | 27 | 1 | in_house |  |
| 33 | Vinho Verde Loureiro/Alvarinho, Quinta de Azevedo, Portugal | CREATE (OAC-only Item) | new (id from request) | 31 | 1 | in_house |  |
| 34 | Picpoul de Pinet, Domaine La Croix Gratiot, Languedoc, France | CREATE (OAC-only Item) | new (id from request) | 34 | 1 | in_house |  |
| 35 | Organic Rosado, Familia Castaño, Murcia, Spain | CREATE (OAC-only Item) | new (id from request) | 27 | 1 | in_house |  |
| 36 | Touraine Rosé, Domaine de La Brossette, Loire, France | CREATE (OAC-only Item) | new (id from request) | 35 | 1 | in_house |  |
| 37 | Organic Monastrell, Familia Castaño, Murcia, Spain | CREATE (OAC-only Item) | new (id from request) | 27 | 1 | in_house |  |
| 38 | Nero d'Avola, Mandrarossa, Sicily, Italy | CREATE (OAC-only Item) | new (id from request) | 32 | 1 | in_house |  |
| 39 | Mendoza Malbec Clásico Organic, Altos Las Hormigas, Argentina | CREATE (OAC-only Item) | new (id from request) | 36 | 1 | in_house |  |
| 40 | NV Monopolio Prosecco Spumante Organic, Cantina di Gambellara, Veneto, Italy | CREATE (OAC-only Item) | new (id from request) | 32 | 1 | in_house |  |
| 41 | 2022 Blanc de Blancs, Raventós i Blanc, Cataluña, Spain | CREATE (OAC-only Item) | new (id from request) | 37 | 1 | in_house |  |
| 42 | 2019 Classic Cuvée Brut, Rathfinny Wine Estate, Sussex, England | CREATE (OAC-only Item) | new (id from request) | 60 | 1 | in_house |  |
| 43 | House Drinks Package | CREATE (OAC-only Item) | new (id from request) | 15 | 1 | in_house |  |
| 44 | Pimms pitcher | CREATE (OAC-only Item) | new (id from request) | 68 | 1 | in_house |  |
| 45 | Aperol Spritz pitcher | CREATE (OAC-only Item) | new (id from request) | 68 | 1 | in_house |  |
| 46 | Mojito Mocktail pitcher | CREATE (OAC-only Item) | new (id from request) | 45 | 1 | in_house |  |
| 47 | Passionfruit and Elderflower Spritz pitcher | CREATE (OAC-only Item) | new (id from request) | 45 | 1 | in_house |  |
| 48 | Mint and Mango Iced Green Tea pitcher | CREATE (OAC-only Item) | new (id from request) | 45 | 1 | in_house |  |
| 49 | Premium wine add-on | CREATE (OAC-only Item) | new (id from request) | 10 | 1 | in_house | needs House Drinks Package, same qty |
| 50 | Prosecco add-on | CREATE (OAC-only Item) | new (id from request) | 10 | 1 | in_house | needs House Drinks Package, same qty |
| 51 | Champagne add-on | CREATE (OAC-only Item) | new (id from request) | 15 | 1 | in_house | needs House Drinks Package, same qty |
| 52 | Cocktails add-on | CREATE (OAC-only Item) | new (id from request) | 12 | 1 | in_house | needs House Drinks Package, same qty |
| 53 | Mocktails add-on | CREATE (OAC-only Item) | new (id from request) | 8 | 1 | in_house | needs House Drinks Package, same qty |
| 54 | Classic Working Lunch | EXCLUDED | – | – | – | none | Absent from the live canonical catalogue; never created. Historical references retained. |

## Decisions and how they are represented

* Finger Food: £3.95 is already the inherited default (an equal override would be refused). OAC override: min 12, guests ≥20, 10 days (240 h), one numeric allocation per variety, each selected variety ≥12, allocation total = pieces. 15 varieties. Gallagher cannot waive variety or event minimums.
* House Drinks Package (new, in-house) with five upgrade Items (in-house) carrying `parentItemId` + `parentQuantity:"same"`: every upgrade quantity must equal the package quantity (the full guest count); any combination may be added; each is its own priced line, so prices accumulate. The parent id is deterministic (`createdItemId`) so the plan can reference it before creation; the plan orders the parent first.
* Juice: the existing canonical 250ml Item (£3 already live) gets an OAC-only choice list (Orange, Apple, Carrot/Pear/Ginger). Other sites keep their five options and routing.
* Croissants: the £60 box-of-12 Item and its history are untouched. A separate OAC-only "Savoury Filled Croissant (each)" at £5, min 12, three fillings, production conversion 1 ordered = 1 croissant.
* Breakfast Pots: existing Item, OAC price £3.50 (default £3.95); min 12 already held by the Item; Gallagher cap 5 applies via the shared rule. No Yoghurt Pot Selection Item.
* Salad Boxes: one allocation across Mediterranean, Chicken Caesar, Salmon Niçoise and the existing Weekly Salad Box option (exactly one variety per box; total = boxes). The separate Weekly Salad Box Item is untouched.
* Summer Rolls: £30 (default £45), min 3 platters, guests ≥20, 10 days, one allocation across the six existing flavours (one flavour per platter, mixed platters allowed), 12 rolls per platter, CPU Sandwiches retained.
* Picnic Grazing Table: notice 7 to 10 days (the 20-guest floor is already the Item default); CPU Hospitality retained.
* Nibble Bowls: £2, serves 3, min 3 bowls per selected variety, in-house.
* Celebration and loaf cakes: quote-only with indicative "from £27 / £20", 72 h notice, no purchase price; checkout is rejected by the shared validator.
* Deli Style Sandwich: shared mnk Item `deli_sandwich_lunch`; OAC override £10.95, min 10, `guestMinimumKind:"product"`; Gallagher effective 5. The mapping `deli_working_lunch` to this Item (54 original records) is preserved for migration. Classic Working Lunch is not created.
* Soft drinks £2 (Coke, Diet Coke, Coke Zero, Sprite), water £3.50 (750ml), canapés/bowl food notice 10 days.
* Wines: exact brochure names (accents preserved) and prices, in-house.

## Assumptions for the operator to confirm (engineering choices, not in the approval)

1. Baps and Juice use a numeric split across the brochure's fillings/flavours (min 1 each) rather than a single-choice selector, so a customer can order a mix without a free-text option. Switch to `select` if mixed orders are not intended.
2. Mini Traybake Bites list their four varieties in the description with no ordering choice (the brochure does not say whether customers choose).
3. The existing shared "Traybake Box" Items (nut / nut-free) are not reused: they carry a distinct allergen identity.
4. VAT 20% is used on every new Price, matching existing OAC prices. This is the platform's existing default, not a per-product determination.
5. Classic Buffet carries product min 50 and event guest floor 50 (the Gallagher product cap leaves the event floor at 50).
6. Wine bottle size is not stated by the brochure and is not asserted.
7. Allergens, dietary flags and ingredients are left empty on every new Item (unrecorded, not clear).

## Code changes

* `lib/oac-approved-catalogue.ts` (new): the 53-row decision table producing governed command proposals; `createdItemId` mirror.
* `lib/hospitality-catalogue-admin.ts`: exports `catalogueCreateItemId` (same formula, now shared with `createItem`).
* `scripts/prepare-oac-catalogue-sync.ts`: builds the plan from the approved table (still file-only, no apply).
* `tests/oac-approved-catalogue.test.ts` (new, 20 tests); `tests/hospitality-booking-service.test.ts`: the stale OAC compatibility test now asserts the deliberate fail-closed behaviour (legacy OAC brochure IDs cannot price a booking).
* The earlier uncommitted engineering (rules module, restricted Items, package v2, migration drafts) was carried over unchanged.

## Validation actually run (this worktree)

* `oac-approved-catalogue` 20/20; together with the OAC rules, sync-plan, package and client tests: 56/56.
* Hub, Hospitality and CPU `tsc --noEmit`: pass.
* Hospitality full suite: 255/255.
* Hub full suite: 773 pass, 64 skipped, 19 fail. Not caused by this work: six fast failures (ADDR-001 spec file, Delivered-In access, Logistics admission trace, site-staffing cancel) reproduce identically in the main checkout; the others are Firestore-emulator suites that timed out because no emulator was running. The one OAC-related failure (the stale compatibility test) was fixed.
* NOT run: browser/staging UAT, Firestore-emulator catalogue suites, CPU test suite, production builds. No staging environment or emulator was available, so these are unverified: portal rendering of allocation controls, cache v3 transition, package v2 publish/hash, live other-OPLOC effective prices, CPU each-versus-box display.

## Blockers and readiness

**Not yet ready for production approval.** Every approved business rule is representable and unit-validated, but these gates are open:

1. Run the catalogue emulator suites and the Hub/Hospitality/CPU builds.
2. Staging UAT (ordinary and Gallagher bookings, allocations, upgrades, quote-only cakes, cache transition) with no emails, CPU hand-offs or Logistics jobs.
3. Re-read live source, regenerate the plan, and have the new plan hash approved.
4. `create-item` refuses a duplicate name at apply time; a clash would block that command rather than create a duplicate.
5. Commit and push are separate: this work sits beside unrelated booking-migration drafts.

## Release plan (not executed)

1. Commit only OAC catalogue files (exclude `oac-booking-migration*`, migration fixtures and dry-run scripts); push `main`.
2. Deploy Hub and Hospitality at the exact SHA; package v2 is not current until published, and updated clients still read v1.
3. Apply commands in plan order via the governed API (creates before upgrades), re-reading each Item version; stop on any 409. Each mutation republishes the package; verify private/public manifests, the raw compressed-byte hash, the OAC effective catalogue, and unchanged effective catalogues at every other OPLOC.
4. Run Gallagher and ordinary checks against the published OAC package; consider migration separately.

## Rollback

Per-command compensation, never deletion: reset OAC overrides with `set-site-override` (`price:null`, `minimumQuantity:null`, `configuration:null`, standard mode) at fresh versions; archive newly created Items with `set-item-status` (they are OAC-restricted, so no other site is affected). Keep all Item, Price, revision, audit and booking evidence. Republish the packages from reverted authority; never repoint a head at stale data.
