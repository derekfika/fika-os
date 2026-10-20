# Hospitality booking cutoff enforcement — 20 October 2026

Status: VERIFIED LIVE for the modern Node portals at application SHA `fbb53143ee0681986821afbd97e43786f8d25e8d`. Hub and Hospitality both serve `build-2026-10-20-002`, SUCCEEDED/READY at 100% traffic. Legacy Apps Script acceptance remains outside scope/unverified; universal enforcement is not claimed. The implementation notes below preserve the original pre-release evidence; the completed release record follows at the end.

## Checkout and ownership

Started on clean canonical `main`, HEAD/origin/main `eb1b0ebdf3266e179c1249a7087a6ba619d1a3f2`; fetched and fast-forward check passed. No new checkout/worktree/branch. Derek confirmed Claude owns migration tooling only. No migration files, source inventories or production configuration were changed.

## Policy and authority

`packages/server-shared/src/hospitality-booking-cutoffs.ts` is the pure shared authority consumed through `@fika/server-shared/hospitality-effective-offering`.

- UK noon: two subsequent preparation days before 12:00; three from 12:00. Saturday is excluded; Sunday counts for preparation. All deliveries are Monday–Friday. Eligible sandwich dates have no additional rolling 48/72-hour condition, so early supported delivery times remain valid.
- Stable canonical/provider identities and current governed `sandwiches` routing classify sandwich-containing products. No display-name matching. Merge chains and exact historical/provider aliases preserve restrictions after identity consolidation.
- Effective Item plus sparse site exceptions supply product notice constraints. Ten-day-and-longer day flags retain the conservative existing **working-day** interpretation (Mon–Fri); independently configured elapsed-hour floors are also enforced when stricter. Ten working days is never replaced by 240 elapsed hours. Existing event minimums remain site-specific (OAC ten working days, other configured large-event paths seven).
- Summer Roll identities are excluded from Friday ordering; no Item is archived or withdrawn. Existing basket lines stay visible as conflicts with explicit removal/amendment controls.
- Current canonical catalogue/routing and authoritative server time are re-read inside the booking transaction. Client names, notice values, submittedAt and policy claims are not authorities.
- New submissions and material amendments (date, time, destination, event requirements, quantities, items/choices) are validated before writes. Contact/notes-only historical amendments and exact ingestion retries retain historical evidence.
- Failures return structured 422 codes and earliestDate where applicable. Rejection creates no booking/audit/notification/production/fulfilment/outbox changes.

## Node platform coverage

| Surface | Client | Authoritative boundary |
|---|---|---|
| MNK `/mnk` | BookingPortal + BookingDatePicker | Hub POST `/api/bookings/mnk` |
| Angel Court `/angel-court` | Same, governed OAC package | Same, canonical OAC OPLOC/effective Offering |
| CFC `/cfc` | Same; existing explicit local catalogue compatibility retained | Same, server-owned catalogue compatibility |
| Munich RE `/munich-re` | Same; existing explicit local catalogue compatibility retained | Same |
| RCoA `/rcoa`, single service | RcoaBookingPortal + BookingDatePicker | RCoA adapter -> same Hub ingestion transaction |
| RCoA All Day/group | Combined basket calendar; all rows prevalidated | Every child uses Hub transaction; group adapter verifies existing children before grandfathering a retry |
| Authorised workspace and `/hospitality/*` aliases | Existing routes reuse the same components | Same Hub commands |
| Standalone staff amendments | Active BookingAmendmentPanel loads current package and uses shared calendar | prepareBookingAmendment transaction |
| Group staff amendments | GroupAmendmentEditor current package/shared calendar; Friday rolls unavailable in add-item selector | amendHospitalityBookingGroup atomic transaction |

Dashboard date-range filters and an unreferenced old AmendmentModal are not booking-entry paths and were not changed. CPU, Logistics, Menu Planner, Delivered-In and Grab & Go have no release changes in this task.

## Group retry contract

The bridge-authenticated POST `/api/bookings/mnk/existing` accepts at most 12 RCoA source IDs and returns only already-persisted IDs, using deterministic direct document reads. It has no write effects and exposes no booking/customer bodies.

The Hospitality group adapter only needs this read when dates now violate policy. It prevalidates every **new/missing** service before the first ingestion call. Persisted historical children can replay without new notifications; a missing child never inherits a sibling's exemption. A failed or inconclusive existence check fails closed. Deploy Hub before Hospitality so this endpoint exists.

## Catalogue package and caches

The package provider publishes additive `bookingPolicy` booleans, derived from governed routing and exact provider aliases. Internal CPU routing remains omitted from the public package. Private/public immutable gzip integrity and old content-addressed object retention are unchanged.

After deploying the new Hub, an authorised administrator must explicitly POST `/api/hospitality-catalogue/package` to rebuild from current canonical data and publish the new public projection. Verify hash, source/policy metadata and unchanged prices/availability, then confirm clients revalidate the manifest and replace their IndexedDB package. This is derived package publication, not a booking/catalogue migration; it has NOT been performed in this task. It is required for opaque canonical IDs whose policy is routing-derived. Existing package contracts and historical immutable URLs remain compatible.

## Wording reconciliation

Removed Node UI standard 72-hour guidance from RcoaBookingPortal and rcoa-portal, removed the generic unused three-day notice calculation, and stopped applying old short sandwich notices as a second rolling-hour restriction. One centrally defined customer message states both sides of noon and Sunday preparation. Hard ten-day/event failures provide explicit earliest dates.

The final operational source scan of Hospitality/Hub/shared code found only the independent quote-only celebration/loaf cake 72-hour notices in `oac-approved-catalogue.ts`. These remain unchanged. Cancellation terms, historical receipts, immutable old quotes/emails, legacy Apps Script copy and Grab & Go rules were not rewritten.

## Validation evidence

- Hospitality full suite: 286/286 PASS at the complete portal integration checkpoint.
- Final affected consumer regression pass: 68/68 PASS, including every mandatory date vector, exact noon in BST/GMT, DST/date arithmetic, independent hour floors, ten working days, historical aliases, RCoA group preflight/retry and staff editor contracts.
- Staff/dashboard/DTO regression checkpoint: 44/44 PASS.
- Hub focused booking/workflow/group/routing/package pass: 54 PASS; 16 separately opt-in emulator cases were skipped in that unit invocation, not claimed as passing.
- Hub actual POST-route emulator integration: PASS. Covers routing-derived opaque ID classification, spoofed client fields, weekends, Friday rolls, site notice override, create/replay, atomic standalone/group amendment rejection, historical contact-only amendment, stricter event changes, merge lineage, and read-only existence check. Before/after complete isolated-store snapshots prove rejection has no operational/audit/outbox side effects.
- Existing Angel Court public ingestion emulator regression: PASS, updated to expect hard long-notice rejection instead of obsolete advisory acceptance.
- Six selected existing group/standalone amendment emulator regressions: PASS (including no-op/history, concurrency, atomic edits, authorization/versions/membership and after-CPU retirement/idempotency). Material-amendment fixtures now provide current canonical Item/Price/OPLOC records and future eligible dates; historical/no-op fixtures remain unchanged. One initially failing negative fixture was corrected to include this required authoritative catalogue evidence and rerun successfully.
- Final provider/package + cutoff emulator run: 7/7 PASS. The extended cutoff emulator case was rerun successfully after adding opaque-ID short-hour compatibility and merged Summer Roll regressions.
- Final Hub booking/price/catalogue-rule focused pass: 40/40 PASS.
- Both affected app typechecks: PASS. Both affected production builds: PASS (release packaging final result recorded in task handoff).
- Diff whitespace check: PASS.

Tests used only the owned local emulator at 127.0.0.1:8292, demo-fika-os. No customer artifacts or real email/CPU/Logistics operations were created.

## Browser evidence and limits

The actual shared React calendar was bundled into an isolated read-only localhost fixture. Browser interactions verified:

1. A prohibited day is grey, has an accessible reason/title, and cannot be selected by tap/click or Enter. Tab moves focus to the next day and updates the reason.
2. Crossing noon changes the earliest date, preserves the now-invalid selection and exposes its conflict.
3. Friday Summer Rolls cannot be selected; ten-working-day dates remain disabled until the correct date, which can be selected and clears the warning.
4. At 358px calendar width there is no overflow; day controls are 44px high, keyboard focus is visible, and disabled text uses semantic readable colours.

Screenshots/evidence are saved outside the repository under `C:\Users\derek\Documents\FIKA OS Migration Evidence\Booking-Cutoffs-2026-10-20`: calendar-noon-conflict.png, calendar-friday-rolls.png, calendar-ten-working-days.png. These prove the shared component, not full signed-in portal journeys or physical-device touch testing.

Automatic approval review rejected the attempted full local Hospitality launch with only “blocked by policy”; no further reason was provided. Full portal browser journeys therefore remain unverified. Component browser checks and actual server/emulator tests were completed through the safe isolated path.

Style Guide compliance: PASS for touched UI. Calendar retains the light surface, semantic tokens, visible focus and accessible status text. At very narrow layouts, the seven-column date grid may use compact-width day cells while preserving 44px height; controls and explanations remain keyboard/touch operable.

## Deployment inventory and required release sequence

Read-only App Hosting verification: fika-os, europe-west4.

| Backend | Current live build | Current live source | Traffic | Automatic rollout |
|---|---|---|---|---|
| fika-os-prod-hub | build-2026-10-20-001 | 85ca1cce311e70c5743b6a772f148c3d403e8466 | 100%, READY | disabled |
| fika-os-prod-hospitality | build-2026-10-20-001 | 85ca1cce311e70c5743b6a772f148c3d403e8466 | 100%, READY | disabled |

All six production App Hosting backends have automatic rollout disabled. No GitHub Actions workflows are present in this checkout. No application rollout was requested or submitted.

After explicit per-application production approval:

1. Deploy Integration Hub from the exact validated implementation commit; verify READY and exact serving SHA.
2. Authorised administrator rebuilds/re-publishes the derived Hospitality catalogue package; verify public policy metadata, hash and unchanged commercial data.
3. Deploy Hospitality from the same implementation SHA; verify READY and exact serving SHA.
4. Test every active portal, workspace/amendment surface and RCoA group in the deployed environment using separately authorised safe UAT procedures. Confirm cache refresh, prohibited-date rejection and no unintended emails/production work.
5. Only then describe enforcement as live. Do not deploy CPU/other apps or run OAC migration/schedulers as part of this release.

Rollback: redeploy the recorded previous app SHA if needed; retaining the Hub enforcement while rolling back only the browser is safer than removing the guard. A full Hub rollback removes enforcement and needs an explicit containment decision. Keep immutable package objects/history; do not delete bookings or rewrite historical evidence. Previously published v2 readers tolerate the additive public policy fields.

## Cost / audit / security

No new polling, broad listeners or operational audit streams. Calendar clock refresh is local at minute boundaries and visibility changes. Ordinary page loads keep the current manifest/IndexedDB package flow; staff amendment editors reuse it. Server mutation reads are bounded to the affected Items, deterministic merge/routing records, relevant sparse Offering/Prices and one OPLOC. Retry existence reads are at most 12 direct documents and only used when policy would otherwise reject an old group. No new indexes or cross-site Item fan-out. Existing business audit/version/outbox and AUTHMOD/bridge guards remain in place; no secrets, IAM or production settings changed.


## Completed production release — 20 October 2026

Derek executed the existing administrator publication endpoint (HTTP 200, published); no alternate publication/authentication mechanism used. Independently verified private v6 `e6fa618fb3fd5e8f5904e4a9afb901bbafe183122c6c73d86ae20ae737f10cdc` and public v6 `b04d129c5b29a96f9c7234dfad1d146b0c55a549216996320ab5a8e2de42d71e`, raw compressed integrity, all 80 policy entries and public routing redaction. OAC resolves to the same 74 offerings with exact commercial and availability equality; the entire catalogue differs only by additive bookingPolicy metadata.

Both production backends serve the approved application SHA above, build/rollout `build-2026-10-20-002`, SUCCEEDED/READY, 100% traffic, automatic rollout disabled. All five portals load their date controls; authenticated workspace access works. Detailed OAC browser checks verify disabled short-notice/weekend dates, preserved invalid selection, Friday Summer Roll exclusion and ten-working-day earliest dates. Four actual negative submissions return the expected authoritative 422 codes and leave their deterministic booking documents absent. No valid customer booking submitted.

The exact client loader, seeded with saved v5 in isolated memory and using live production HTTP, replaces it with verified v6 then serves a warm cache hit. This is not direct browser IndexedDB introspection. Noon/Sunday vectors were evaluated with synthetic clocks against production catalogue data; the production clock was not changed and a real wall-clock noon crossover was not observed. No CPU/Logistics, migration, emails, legacy or scheduler actions. No additional builds/tests repeated. Previous application SHA `85ca1cce311e70c5743b6a772f148c3d403e8466` and immutable v5 objects remain available for governed rollback.

Full evidence: `C:\Users\derek\Documents\FIKA OS Migration Evidence\Booking-Cutoffs-2026-10-20\production-release-verified-live.md`, including exact hashes, live traffic receipt, negative API responses, catalogue comparisons, cache-loader receipt and browser screenshots/transcripts.
