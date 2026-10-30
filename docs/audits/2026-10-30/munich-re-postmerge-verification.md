# Munich RE post-merge verification — 30 October 2026

**Decision: NOT READY for complete staging UAT or operational release.** The location
dropdown and contextual minimum foundation are demonstrably present. Merged source,
currently serving staging code, governed catalogue data and operational UAT are separate
gates. This is a focused #119/#160 verification, not the final whole-platform forensic
audit or an operational sign-off. No application corrections or deployments were made.

## Frozen source and authority

- Fetched main and clean canonical HEAD: `04bf415dc719bc4b899335f77886d5db13df7769`.
- #176 merged that source, with parents `32e0ac55fc8a01bc81085ce78dac2daedb892d51`
  and validated integration head `b86530a56ee7204fe641e61a7c3b452b5b73dae1`.
  Their complete trees compare equal. GitHub independently reports #125/#128/#176 merged.
- Original #128 head `37d757a2ca8f9b04343013fe817b631191a3e019` and #125 tip
  `24cfb9bae7a06bb59dc53c44ad64b7db0f7b1904` remain in this ancestry.
- Original portal lease is revoked; successor `munich-re-128-integration` is retired,
  with pushed/in-main/merged-PR completion evidence. This is no longer recovery work.
- No active lease overlaps the examined Munich RE portal, booking-service or shared-rule
  implementation paths. Claude's `rcoa-oac-wines` lease **does** own Catalogue Editor
  paths needed by the proposed configuration UI follow-up; none was edited.
  Other existing active leases are `adhoc-launcher-config` and
  `iss-001-di-cache-resilience`; their scopes were retained.
- This verification uses separate lease `munich-re-uat-verification`, ID
  `a94cf0b7-ffc4-4e81-a6a7-0ed78bb1ec7e`, owner `sol-munich-re-verification`,
  scoped only to this report. Dependencies/emulator state are isolated in its worktree.
- #176 exact-source CI was independently read as SUCCESS:
  [FIKA validation 41063388713](https://github.com/derekfika/fika-os/actions/runs/41063388713).
  That is prior integration evidence, not a new staging UAT result.

## Authoritative form inspection

The [owner-supplied Microsoft Form](https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=oVkiWKrcykyxz-YNPwRezboAkNWqKJNChPRFvgqIqatUN0Y0Q0I1Q1hOMUpXSDhCM0RZMTFVV0hTNS4u)
was opened in the authorised browser. Details and all six product sections were inspected:
drinks, breakfast, lunch, finger food, afternoon/events and sweets. Required navigation
fields used explicitly synthetic values (`uat@example.invalid`, inspection-only name,
future date); no product was ordered and **Submit was never clicked**. The form tab was
closed without submission. No real booking, email or production write occurred.

The form confirms 72 hours / three working days for food and food cancellation, 24 hours
for tea/coffee, seven working days for larger bespoke requests, a **2% total service fee**,
and a Coupa PO to follow the quote/confirmation. It does not specify VAT treatment.

| Area | Result | Evidence and limit |
|---|---|---|
| Seven meeting rooms | PASS | Acacia (20), Aloe (5), Ginko (5), Ironbark (14), Avon (16), Amazon (16), Flex (Avon and Amazon combined). Flex capacity is not stated or invented. |
| Three collection points | PASS | Level 2 Pantry, Level 3 Reception, Level 5 Cafe, exactly as the form and shared/client directories. |
| Currently served staging dropdown | PASS | Browser `/munich-re` → Lunch → Details shows all seven rooms and three collection points. No contact/booking submission performed. This is Hospitality's older serving source, not proof of integrated main deployment. |
| Product names, printed prices and stated servings | PASS for transcribed headline data | Compared all 28 priced rows in `munich-re-form-catalogue.ts` with all form sections. Water for Flex remains unpriced/not orderable. This does not approve canonical Item mappings, tax basis or option quantities. |
| Choice allocation parity | FAIL | Form requests quantities by flavour/variety for juices, baps, premium breakfast, rice rolls, finger food, dessert/loaf options. Local rows model these as multi-selection flags, without per-option counts. Rice rolls explicitly say one flavour per platter; a multi-select alone cannot retain how many platters of each flavour were requested. |
| Details parity | FAIL / owner disposition needed | Form requires internal/external meeting type, a named business unit, dietary answer, cost code and end time. Portal has free-text company, optional invoice/PO and optional end time, without explicit meeting-type/business-unit/cost-code fields. Decide which source fields must be preserved structurally rather than assuming equivalence. |
| VAT and total price parity | BLOCKED | Form is VAT-silent; owner-reported brochure is VAT-inclusive. Code describes local prices as net with `vatRate:null`; initial Hub booking records VAT zero. The form's 2% fee is expressly not modelled by the local catalogue. Owner must approve the pricing/fee basis before financial UAT passes. |

For orientation: the form's £150 Light Table Lunch platter becomes £150 of initial
server `netTotal`, VAT zero; 2% of £150 is £3, which this automatic flow does not add.
This arithmetic does not decide VAT treatment or whether manual quoting may add an
approved charge. No tax conversion, catalogue publication or charge was applied.

## Minimum rules and specific defects

| Rule | Result | Evidence |
|---|---|---|
| Standard catalogue minimum 8 | PASS locally | Shared and Hub tests reject 7/accept 8 for ordinary OAC/CFC standard-eight items. This is not a blanket minimum for products with their own pack rules. |
| Munich RE contextual minimum 5 | PASS locally | Only base 8 is lowered to 5 by `hospitality-site-minimums.ts`; Hub route emulator rejects 4/accepts 5. Other explicit MR minimums 1/3/4/5/10/12/20/30 survive. |
| Finger-food six guests | PARTIAL foundation | Existing per-Item/Offering guest minimum and validator can express 6, but the intended canonical offering and actual Sam configuration have not been established. |
| Six pieces per finger-food variety | PARTIAL foundation | Governed `quantities` choice groups support `minimumQuantity:6`; isolated reproduction rejects five pieces per selected variety. Form fallback is not configured this way. |
| Four distinct finger-food varieties | FAIL | No corresponding field exists in `SiteConfiguration` or `CatalogueChoice`; the validator counts quantity total but does not enforce distinct positive allocations. Synthetic reproduction with guest minimum 6 and variety minimum 6 **accepts three varieties × 6**. |
| Configurable by Sam | BLOCKED / incomplete | Catalogue backend has settings primitives, but inspected editor UI exposes price/minimum/wording rather than the complete guest/per-variety/distinct configuration. Sam's capability and exact target offering still need confirmation. |
| No site-wide 6/6/4 | PASS as current interpretation | Owner correction in #119 comment 6517754388 controls. Do not apply six guests/six pieces/four varieties to drinks, breakfast, sandwiches or unrelated platters. The form's older finger-food wording is five small servings and recommends three options per five people; the owner override must attach to the intended offering only. |

**SHARED-MR-001 (P1, high confidence):** distinct-variety constraint is unrepresentable.
Reproduction imports `validateCatalogueRules` unchanged and supplies a synthetic item
with minimumGuests 6, quantity-group minimum 6, options a/b/c/d and allocations a=b=c=6.
It accepts 18 pieces over three varieties; five guests and five per variety correctly
reject, and four varieties × 6 accepts. Operational impact: an otherwise configured
finger-food order can violate the owner's policy. Smallest correction direction:
an optional, backwards-compatible per-choice-group distinct-positive-allocation minimum,
server and browser validation plus governed Sam-editable configuration; never a global
Munich RE rule. Regression cases must cover 5/6 guests, 5/6 pieces, 3/4 varieties,
zero allocations, sum mismatch, explicit pack minima, unrelated products and legacy data.

**PORTAL-MR-001 (P1, high confidence):** multi-select fallback loses per-variety quantities
required by the form. Operational impact: a chef cannot reconstruct, for example, one
meat and two veggie platters from a count of three plus two selected flags. Reuse the
existing governed quantity-allocation contract after unit/mapping decisions; preserve
stable option IDs, quote snapshots and production conversions. Test roundtrip to Hub,
quote, CPU lines and fulfilment without multiplying counts twice.

**HUB-MR-001 (P1, high confidence for code; live-data coverage blocked):** the fallback
catalogue/classification is not equivalent to completed governed mapping. Source inventory
contains 1 direct candidate, 2 site-config candidates, 8 ambiguous and 17 missing rows;
no live operational mappings were inferred from that inventory. Portal site config has
no canonical MR OPLOC binding, so the explicit local compatibility path remains active.
Backend default governed-routing platforms contain RCoA only; without a separately set
MR environment override, MR keeps transitional legacy all-line CPU inclusion. Unmapped
work is displayed as routing-required, but the backend handoff's fail-closed routing
gate is conditional on the platform being governed. Do not assert MR is safely governed
from its routing-plan test alone. Verify bounded live mappings, canonical OPLOC, exact
Item IDs, production-unit conversions and environment policy before handoff UAT.

**PORTAL-MR-002 (P1, high confidence):** monetary/administrative parity is not settled.
The printed prices, `vatRate:null` local snapshot, zero initial booking VAT, missing
automatic 2% fee and absent structured source fields need explicit disposition before
quote acceptance. This is a business decision and scoped implementation task, not
permission to rewrite prices or production data during verification.

## Canonical workflow trace and evidence limits

1. `BookingPortal.tsx` submits to Hospitality `app/api/bookings/route.ts`; server
   `lib/hub.ts` forwards to Hub `/api/bookings/mnk` with the existing bridge credential.
   Hub validates and `ingestMnkBooking` owns canonical Booking persistence. The local
   MR test calls this real Hub route, not the browser/server proxy or real staging bridge.
2. `hospitality-price-trust.ts` ignores browser line prices and resolves canonical
   mappings or the explicit local MR compatibility catalogue. `buildMnkCanonicalBooking`
   applies contextual quantity rules and retains `roomOrArea`/`deliveryPoint`.
3. `production-domain.ts:createProductionFromApprovedBookingTransaction` requires
   Quoted/Approved state, canonical destination OPLOC and a current quote revision with
   saved Drive PDF. It derives stable order/line/quote references, preserves customer
   quantity/unit/choices and requires explicit production conversion; unresolved
   conversion becomes a review exception, not invented production portions.
4. Production Order origin is `hospitality_booking`. Its destination label includes
   portal label and room/collection point. `apps/shared/fulfilment-requirement.ts` carries
   production quantity/unit, ordered presentation quantity/unit, canonical IDs and
   destination label into Fulfilment Requirements; Logistics reads Hub requirements
   and CPU production context through `apps/logistics/lib/upstream.ts`.
5. Booking changes stage authoritative events/fulfilment and Logistics outboxes in
   existing transactions. Cancellation/amendment keeps source and quote lineage;
   advanced CPU work remains review-required, and unavailable downstream services stay
   pending. Replays use stable identities and versions instead of duplicating work.

**PASS at test scope:** real Hub route → emulator Booking creation, rejected write,
canonical price, replay uniqueness, room/collection retention and cancellation;
generic persisted amendment/cancellation/concurrency/outbox behaviour; CPU signing
lineage/allergen review; Logistics mocked-authority withdrawal/assignment integrity.

**BLOCKED at end-to-end scope:** no MR quote PDF was created, no live Sam mapping/config
was changed, no actual CPU or Logistics HTTP service accepted an MR handoff, no real
staging booking was submitted, and no MR amendment moved an actual scheduled delivery.
The group emulator uses local CPU/Logistics HTTP stubs, not deployed consumers. A
routing-plan assertion is not proof of delivery. Signed allergen release/physical
packing/driver completion and owner UAT remain unverified.

## Staging serving state — authoritative read-only observations

Observed 30 October, approximately 13:51–13:56 UTC via canonical governed
`fika deploy <app> --staging --sha <frozen-main>` **without execute**. These calls
inspect App Hosting; they do not deploy or alter release pointers. All observed
rollouts were SUCCEEDED, serving at 100%; the CLI's serving check also requires READY
builds, quiescent traffic and automatic rollouts disabled.

| App / staging backend | Serving SHA | Build | Integrated frozen source serving? |
|---|---|---|---|
| Hub / fika-os-staging | `54df60d4fdc6401a6fab3652247e977cd17051ef` | build-2026-10-30-001 | NO |
| Hospitality / fika-hospitality-staging | `37d757a2ca8f9b04343013fe817b631191a3e019` | build-2026-10-29-003 | NO; contains original MR portal work but not the whole integrated main tree |
| CPU / fika-cpu-production-staging | `f9e519428d14fc90dec94f34a5f2e1f38ff0d1d5` | build-2026-10-26-001 | NO |
| Logistics / fika-logistics-staging | `8f0047c7a554669237f4a3fe84642095718af5e5` | build-2026-10-29-001 | NO |

**ENV-MR-001 (P1, high confidence):** staging is a mixed-source environment. In
particular, Hub's serving source is the Catalogue Editor permitted-sites change and is
**not an ancestor of frozen main** (`merge-base --is-ancestor` exits 1). It lacks the
new MR shared catalogue/minimum/Hub-ingestion files. Do not simply deploy main over
Claude's currently serving editor work. Coordinate that source and lease, establish
an approved integrated candidate retaining required work, validate exact source and
obtain separate staging deployment approval. No release action was taken here.

## Actual validation performed

Environment: Windows, Node v24.21.0, npm 11.19.0, Java 21.0.12.1. Fresh workspace-local
root/Hub/Hospitality/Logistics dependencies installed with `npm ci`. No environment
files copied. Emulator project `demo-fika-os`, `FIKA_RUNTIME_MODE=local`, Firestore
`127.0.0.1:14520`, auth host `127.0.0.1:14521`; each `emulators:exec` lifecycle was
started/stopped normally. No production Firebase project was a test target.

| Check | Result |
|---|---|
| Hospitality: munich-re-portal, mnk-contract, gallagher-rules, quantity-entry | 38 PASS |
| Hub: MR minimum/onboarding, brochure mapping, CPU routing, effective offering, fulfilment staging, additional charges and guarded generic integration suites | 62 PASS / 24 explicitly emulator-disabled skips / 0 FAIL |
| Real Hub MR submission emulator test | 1 PASS / 0 skipped |
| Group amendment and cancellation-notification emulator suites | 26 PASS / 0 skipped |
| CPU Hospitality signing-lineage/allergen-review tests, memory store | 23 PASS |
| Logistics batch4 integrity and assignment-integrity diagnostics, in-memory harness | 34 PASS |
| Hub and Hospitality typechecks | Both PASS: `tsc --noEmit --incremental false` |
| Synthetic distinct-variety reproduction | Confirmed defect: 3 × 6 ACCEPTED; 4 × 5 and 5 guests REJECTED; 4 × 6 ACCEPTED |
| Application builds, full suites, browser booking submission, staging operational writes | NOT RUN; no source implementation change, and no complete staging journey authorised/performed |

Commands ran in the corresponding isolated app directory. Test runner was
`node node_modules/tsx/dist/cli.mjs --test ...` (CPU used the same workspace's Hub tsx
binary); Logistics used `node --test tests/batch4-integrity.test.cjs
tests/assignment-integrity-diagnostic.test.cjs`. Emulator commands used the Hub-local
Firebase CLI with `emulators:exec --only firestore --project demo-fika-os --config
<temporary port-14520 config>`. Flags were `FIKA_MUNICH_RE_EMULATOR_TEST=true` for MR,
and `FIKA_UAT_INTEGRATION_EMULATOR_TEST=true` for generic amendment/cancellation cases.
The unrelated group-routing test requiring hard-coded port 8905 remained skipped.
Initial Logistics harness attempts failed for absent isolated dependencies (TypeScript,
then a Logistics-only dependency); after installing its actual lockfile dependencies,
the unchanged suite passed 34/34. No test/source was edited to make it pass.

Raw local logs: `%TEMP%/mr-hospitality-focused.log`, `mr-hub-focused.log`,
`mr-emulator.log`, `mr-amendment-emulator.log`, `mr-cpu-focused.log`,
`mr-logistics-focused.log`, `mr-integration-hub-typecheck.log`,
`mr-hospitality-booking-typecheck.log`. No prior results were presented as new tests.

## Actionable staging UAT checklist

PASS below is explicitly limited to its evidence; BLOCKED journeys must not be
counted as successful live UAT. Sam/owner must confirm the exact eligible finger-food
Item/Offering IDs and approve price/unit/routing decisions before data configuration.

| Journey / acceptance | Status now | Next action / owner |
|---|---|---|
| Source/provenance and fresh governed ownership | PASS | #176 ancestry verified; retain original evidence. |
| Open source form; seven rooms and three collection points | PASS | Independently compared form, integrated lists and serving staging dropdown. |
| View all 28 headline products/prices and correct pack descriptions | PASS at source comparison | Sam reviews governed mapping/serving units; do not infer operational availability. |
| Enter different quantities of multiple flavours/varieties, then reload/quote | FAIL | Engineering: replace lossy flag-only allocation using governed unit-aware choices. |
| Standard 8, MR override 5, explicit pack minimums unchanged | PASS locally | Repeat through aligned staging portal and Hub after approved deployment. |
| Correct offering rejects 5 guests, 5 pieces, 3 varieties; accepts 6/6/4 | FAIL | Sam names offering; engineering adds configurable distinct count; test unrelated offerings unaffected. |
| Sam edits/reloads the finger-food policy with capability checks | BLOCKED | Coordinate Claude's editor lease; implement approved minimal configuration surface. |
| Form meeting type/business unit/cost code and end time roundtrip | FAIL parity | Owner dispositions plus narrowly scoped typed fields/validation where required. |
| Quote/confirmation shows agreed VAT and 2% fee exactly once | BLOCKED | Owner commercial decision, then tests for net/gross/fee/replay and historical snapshots. |
| Correct staged OPLOC, provider links, prices, CPU routing and conversions | BLOCKED | Bounded authorised data inspection and Sam/owner decisions; no speculative promotion. |
| Integrated candidate serves on coordinated staging backends | BLOCKED | Reconcile current Hub editor source, validate candidate, obtain deployment approval. |
| Submit valid MR room booking through Hospitality proxy to Hub | BLOCKED live / PASS direct Hub emulator | Synthetic staging case only after deployment/data/bridge readiness; record Booking ID/version. |
| Collection booking persists collection field, not room; retains downstream label | BLOCKED end-to-end / PASS direct persistence | Trace same synthetic ID to Production Order → Fulfilment → Logistics stop/load. |
| Repeated submit/send creates one Booking and one current order/requirement | BLOCKED full chain / PASS tested boundaries | Repeat real service chain with stable IDs and counts; inspect outbox completion. |
| Quote saved, send CPU, explicit conversion and correct portions | BLOCKED | Use approved synthetic quote fixture/isolated Drive destination, mapped Item and real CPU service. |
| Amend quantities/date/Acacia → collection after handoff | BLOCKED MR full chain / PASS generic emulator | Verify revision, prior withdrawal, replacement IDs/units/location and Logistics reschedule. |
| Cancel before/after planning; unavailable downstream remains pending | BLOCKED actual consumers / PASS generic emulator | Confirm withdrawn requirements/loads; advanced CPU work must show review-required. |
| CPU review, allergen evidence, signing lineage and quantities | BLOCKED operational / PASS unit contract | Checker-owned synthetic review on actual staging CPU; no fabricated allergen clearance. |
| Logistics planning/driver location and quantities; no stale withdrawn work | BLOCKED MR journey / PASS in-memory integrity | Dispatcher/driver validate same synthetic source/requirement and stop identity. |
| Owner acceptance and operational release | BLOCKED | Complete checklist, owner UAT, release provenance and separate release authorisation. |

## Recommended next task and exact proposed scope

First obtain the owner's target finger-food Item/Offering IDs, intended venues and sales
unit, VAT/2% fee disposition and which source details are mandatory. Then allocate
**one coordinated catalogue/rule contract task** after Claude releases or explicitly
hands off overlapping ownership. No permission to edit those paths is implied here.

Smallest coherent finger-food engineering scope to review:

- `packages/server-shared/src/hospitality-catalogue-rules.ts`: optional distinct-positive
  choice minimum and shared validation, backwards compatible and offering-specific.
- `apps/integration-hub/lib/schemas.ts`: strict serialised configuration field.
- `apps/integration-hub/lib/hospitality-catalogue-types.ts`,
  `lib/hospitality-catalogue-read-model.ts`, `lib/hospitality-catalogue-admin.ts`,
  `app/api/hospitality-catalogue/route.ts`, `app/ui/HospitalityCatalogue.tsx` and its CSS:
  governed Sam-readable/editable policy (several currently Claude-owned).
- `apps/hospitality-booking/lib/hospitality-portal-catalogue.ts`,
  `lib/mnk-contract.ts`, `app/ui/BookingPortal.tsx`: propagate/display the policy;
  preserve per-option quantities, units and existing shared validation.
- Focused new shared-rule tests, Hub schema/admin/emulator tests and Hospitality
  catalogue/portal tests; re-run all affected shared consumers per repository rules.

Do not silently fold VAT conversion, catalogue promotion, source-field schema changes,
staging deployment or real order repair into that task. Those need separately agreed
scope/authority. After engineering/data decisions and coordinated staging approval,
run the exact-source MR synthetic full-chain checklist above. No migrations, new
recurring reads, audit pipeline or runtime behaviour were added by this verification.

No application implementation was changed. This report is the sole tracked change;
documentation-only work needs no changelog fragment. Deployment: none.
