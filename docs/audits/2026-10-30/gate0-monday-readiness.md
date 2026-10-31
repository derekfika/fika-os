# Monday kitchen readiness — Gate 0, 2–6 November 2026

Read-only audit by Sol, 30 October 2026. Coordination: #160 and the existing Codex dispatcher (Luna Friday 30th).

## Recommendation: NO-GO at this snapshot

Canonical quantities are consistent for the published work, but this is not evidence that the kitchen can safely release it. CPU allergen review/release is unavailable in every inspected Delivered-In package; delivery planning has no assigned loads; Brian's own access and real operating journey remain NOT VERIFIED. These are pre-service gates, not authorisation to change data. Recheck after authorised operational owners complete them. Printing/hardware is DEFERRED to Derek at his explicit instruction and is not an additional blocker imposed by this audit. Luna owns the requested future Run Sheet day selector and category-organised Totals changes; no such UI work was attempted.

No menus published, orders created, bookings changed, operational data repaired, merges or deployments performed. No application implementation was needed or authorised. Only this evidence report changes in Git.

## Baseline, leases and method

- Fresh origin/main: `8512119ea697d7de797b51c99b84d31cce71635c`; canonical checkout clean. Refetched at the serving check: unchanged. Production is assessed against actual serving SHAs below, not assumed to serve main.
- Report workspace: `gate0-monday-readonly`, owner `sol-gate0-readiness`, lease `49467c6b-0a83-4b6a-ac9c-342beb4b4431`, branch `codex/gate0-monday-readonly`. Sole scope: this report.
- Other active leases: `adhoc-launcher-config` / `luna-adhoc-launcher` (Hub staging config + related test); `iss-001-di-cache-resilience` / `haiku-iss-001` (Delivered-In); `rcoa-oac-wines` / `claude-rcoa-wines` (specific Hub Hospitality Catalogue Editor/admin/read-model/tests/docs/script paths). No overlap or edits to these paths.
- Initial Hub staging release lock and operation `54b10d81-d5d8-4108-b07e-32941cbb0e20` were preserved. At 16:45 UTC no release locks or active operation markers remained; this audit did not clear/reconcile them. Concurrent local dry-run inspection lock refusals were respected and remaining reads rerun sequentially.
- Authenticated Firestore REST read queries and document/batch reads against project `fika-os`; GCS downloads with `decompress:false`. Query scope: service/delivery dates >= 2026-11-02 and < 2026-11-07; week equality, publication equality and explicit known IDs. Caps <=501 documents, none hit. A bounded requiredBy compatibility query added no other canonical orders. No collection scans, seeds, mutations, reconciliation or package-rebuild endpoints.
- Snapshot window ended at 2026-10-30T16:45:42.162Z. A final updateTime comparison of the selected week, publication, 26 orders, 21 requirements, CPU projections/heads, DI heads and Logistics jobs found zero changes. This is a bounded observation, not a transaction spanning every service or a promise of future freshness.
- All 34 downloaded CPU/DI gzip packages passed raw compressed-byte SHA-256 checks before decompression; six CPU packages match stored projection orders exactly. Menu inline published-week gzip also passed hash `fae37f3a802065eccdad631e94ee18231a5ac8e9cd6cd5d0f4b6b4beb04db543`. Raw runtime snapshots remain private in the local temporary evidence files; no contacts, signatures, credentials or raw runtime stores are committed.

## Serving versus release ledger — PASS

Control-plane traffic was a single 100% build, non-reconciling, READY/SUCCEEDED, automatic rollouts disabled for each backend. Latest release refs were freshly fetched.

| App | Serving source SHA | Build | Release ledger commit | Result |
| --- | --- | --- | --- | --- |
| menu | `39f642d190513b8dca612c80635b8f262b0f7f10` | build-2026-10-28-001 | `e8f4d23957b7b6614258943da02968299ae114cb` | PASS |
| hub | `c8f20b897306b152cfdeb99f4d6476f3f21d47a7` | build-2026-10-22-002 | `2a3cb66c190f7a12f6828de5f2861471b04ed746` | PASS |
| cpu | `29e19f4e1e386dc5f631b176e3f29bc6829b9651` | build-2026-10-23-002 | `b14dc32c1fe042a41a92091ff83273fdd5f0befd` | PASS |
| delivered-in | `a4339e74c6a7fd711aa76248a1d8c6afa691fdf5` | build-2026-10-23-002 | `425a935169d40a094a5b8ee8c9a0c09501d17d4d` | PASS |
| logistics | `5348f500bad837be5a4972fe9cfadcbed61aa8f5` | build-2026-10-19-001 | `f004514a9c9f958903ce9367f0a63638436b495b` | PASS |

Serving observation: 2026-10-30T16:48:26.309Z. Menu's side-effect-free public `/api/build-info` additionally returned HTTP 200, appId menu-planning and exact SHA `39f642d190513b8dca612c80635b8f262b0f7f10`. Other app SHAs are independently authenticated App Hosting serving evidence; authenticated Brian browser journeys were not demonstrated. Newer main code is not claimed live.

## Gate matrix

| Journey / check | Status | Evidence and implication |
| --- | --- | --- |
| Published Menu week and current day revisions | PASS | One published week, publication v4; five current days, fifteen historical superseded days. No double-counting old revisions. |
| Dish identity and allocated portions | PASS | All 82 referenced dish IDs exist in Menu catalogue; 240 positive allocation lines equal Hub and CPU lines and DI site/day entries. No name-based joins. |
| Catalogue reconciliation | NOT VERIFIED | 73 IDs marked reconciled, nine marked unreconciled/local. IDs preserved; no guessed Hub replacement. See exact ledger below. |
| Latest publication occurrence identity | NOT VERIFIED | 19 Tue–Fri Hub/CPU POs retain v1 occurrence IDs; current Menu/DI uses v4. Content versions/hashes/quantities match. Review compatibility rather than rewriting history. |
| Menu outbox for this publication | PASS | 112/112 delivered, no pending/failed/dead-letter in bounded publication query. |
| CPU durable propagation for selected orders | PASS | 78/78 delivered. Delivered receipt alone is not proof of signed release availability. Hub→CPU notification is a direct retrying call, not this durable queue. |
| CPU Day and Week data | PASS | 25 active orders, each line matches Hub; five day packages and week package match stored projections. No historical cancelled RCoA work included. |
| CPU Totals / Run Sheet source data | PASS | Same canonical quantities available; no browser rendering, physical output or Brian use is claimed. Mixed units kept separate here. |
| Brian login, navigation and actual Day/Week/Totals/Run Sheet use | NOT VERIFIED | No Brian-session journey evidence from dispatcher or owner. Do not infer access from administrator reads. |
| CPU review and release into DI | BLOCKED | 94/101 current published entries lack confirmed allergen evidence; all 28 DI packages say CPU_REVIEW_UNAVAILABLE, siteMenu none, no CPU release/order lineage. |
| Submitted Delivered-In Grab & Go | PASS | Two submitted MNK source orders, six lines and 22 items each on Mon/Wed; same product IDs/quantities downstream. Individually labelled source handling is separate from Menu review. |
| Fulfilment and Logistics projection | PASS | 21 retained requirements/jobs: 20 active + one withdrawn RCoA; IDs, versions, hashes, line quantities/units and withdrawal match. 35/35 selected Logistics outbox events delivered. |
| Delivery run/load readiness | BLOCKED | 20 active jobs pending; zero service-date loads; two empty Monday draft runs. Routes/times/drivers and driver workflow not demonstrated. |
| Cancellations/supersession/duplicates | PASS within scope | One cancelled booking's historical amended PO and withdrawn requirement/job correctly excluded. No duplicate active canonical order/requirement/job identity found. No additional requiredBy-only order. |
| Manual packing fallback | NOT VERIFIED | Source has printable whole-day collection/packing support, but no named manual process/sign-off supplied. No packing-state writes attempted. |
| Printer/hardware | DEFERRED | Derek explicitly deferred hardware/printing; no print test or printing implementation pursued. |

## Quantities and exact references

These are dish portions summed across menu lines, not diners or delivery-container counts. Grab & Go is measured in items. Never add them as one operational portion total.

| Date | Menu entries | Menu portions | G&G items | Active POs | CPU numeric summary (mixed units) | Unconfirmed Menu entries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-11-02 | 17 | 924 | 22 | 5 | 946 | 16 |
| 2026-11-03 | 22 | 980 | 0 | 5 | 980 | 20 |
| 2026-11-04 | 25 | 2107 | 22 | 7 | 2129 | 25 |
| 2026-11-05 | 22 | 1324 | 0 | 5 | 1324 | 19 |
| 2026-11-06 | 15 | 1235 | 0 | 3 | 1235 | 14 |
| Week | 101 | 6570 | 44 | 25 | 6614 | 94 |

Current week `rolling-week:2026-11-02`, compiled source version `rolling-week:2026-11-02:v226`, publication `menu-publication:rolling-week:2026-11-02`, compiled snapshot `menu-publication:rolling-week:2026-11-02:snapshot:v4`. Publication occurrence v4 is distinct from each day's content version.

| Date | Current publication day | Content version | Content hash |
| --- | --- | ---: | --- |
| 2026-11-02 | `menu-publication:rolling-week:2026-11-02:v4:day:0` | 4 | `71a30482128687d654fc8d3c3a0a39577f623475f6e2cbdc6847936dcf3a9eb9` |
| 2026-11-03 | `menu-publication:rolling-week:2026-11-02:v4:day:1` | 1 | `42150b9d20a9f416db5a1e2000de6e0225d0b397fb5db5c76d1ac7b99b7dcc10` |
| 2026-11-04 | `menu-publication:rolling-week:2026-11-02:v4:day:2` | 1 | `ad92cbac32cfe4bf07476873abd9fdc7f338b7432f296d42180ca4408b8c7a89` |
| 2026-11-05 | `menu-publication:rolling-week:2026-11-02:v4:day:3` | 1 | `a88a35acbd3f5354bcfac45a823b6d1489b0383904f3000a927c25f96d1bc6fe` |
| 2026-11-06 | `menu-publication:rolling-week:2026-11-02:v4:day:4` | 1 | `1d5480229a3328146291e427ab257993ce699a3e594dd853a508c9a1b13afcd9` |

Site codes below are presentation shorthand only; the canonical ID is identity. A dash means no published work in this snapshot, not a request to invent it.

| Code / site | Canonical OPLOC | Mon portions | Tue | Wed | Thu | Fri |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| OAC / One Angel Court | `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` | 40 | 40 | 40 | 40 | — |
| MNK / MNK | `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f` | — | — | — | — | 1000 |
| FX / FIKA Xchange | `oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d` | 320 | 250 | 350 | 385 | 20 |
| HAL / Haleon | `oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b` | 350 | 300 | 395 | 445 | — |
| OPT / Optiver | `oploc:763d5a92-5c8b-4f2e-bd45-f867db453a84` | 214 | 250 | 272 | 294 | 215 |
| CB / Commerzbank | `oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c` | — | 140 | 150 | 160 | — |
| BP / Bridgepoint | `oploc:a358ef5f-297b-4816-bbf5-7fef470e81d7` | — | — | 900 | — | — |

For each nonblank Menu cell the exact PO ID is `production-order:v1:menu-planning:rolling-week:2026-11-02:day:D:OPLOC`, where D is 1–5 for Mon–Fri and OPLOC is the complete canonical OPLOC string above. Hub order documents use SHA-256 of that canonical ID. CPU plans use the raw order ID.

The five FX destination orders intentionally have no delivery requirement: `apps/shared/production-location.ts` identifies FIKA Xchange as CPU_SITE_OPLOC_ID and `productionOrderRequiresFulfilment` excludes it. The remaining eighteen Menu orders plus two G&G orders have twenty active requirements/jobs. Requirements have seventeen ready_for_planning + three amended; jobs have seventeen ready + three attention among active work. A ready_for_planning projection is not kitchen allergen-release approval.

G&G source IDs: `grab-and-go:oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f:2026-11-02` and the same prefix ending `2026-11-04`, both submitted version 1. Production IDs are `production-order:v1:grab-and-go:SOURCE:oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f`. Fulfilment IDs are `fulfilment-requirement:grab-and-go:SOURCE:oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f`.

| Product ID (both dates) | Items per date |
| --- | ---: |
| `grab-250ml-greek-yoghurt-mango-passionfruit-tropical-granola` | 4 |
| `grab-250ml-coconut-yoghurt-acai-berries-toasted-coconut` | 3 |
| `grab-250ml-pineapple-kiwi-black-grape` | 3 |
| `grab-250ml-overnight-oats-pear-blueberry-pumpkin-seed` | 2 |
| `grab-250ml-smoked-salmon-smashed-avocado-boiled-egg` | 4 |
| `grab-250ml-hard-boiled-eggs-baby-spinach-cress` | 6 |

### Cancelled RCoA: preserve and exclude, do not restore

Booking `booking:rcoa:fd16fd79761b5b550dfbcfb3491fedba`, site `oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2`, service 5 November 12:00, lifecycle **Cancelled** at 26 October 10:49:10.590 UTC, reason Testing. Historical PO `production-order:v1:booking:rcoa:fd16fd79761b5b550dfbcfb3491fedba` is version 6/status amended, source quote r1; it retains 12 people / 36 pieces of `hospitality-menu-item:mnk:deli_sandwich_lunch`. This is not extra active work. The booking current quote is r2, not a new authorised production order.

Its requirement `fulfilment-requirement:cpu-production:production-order:v1:booking:rcoa:fd16fd79761b5b550dfbcfb3491fedba:oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2` is withdrawn; the corresponding `logistics-job:REQUIREMENT` has sourceStatus withdrawn. Its deliveryStatus pending does not make the withdrawn source active. CPU excludes the historical order, so Thursday 1324 and week 6614 mixed-unit totals are correct. Initial suspicion of an omitted 36 pieces was withdrawn after checking authoritative booking lineage. The old signed CPU plan/release remains historical evidence, not permission to resurrect it.

### Republished occurrence caveat

All nineteen Tue–Fri Menu POs and CPU rows retain `menu-publication:rolling-week:2026-11-02:v1:day:N` (N=1–4), while current Menu/DI uses `...:v4:day:N`. The v1 subcollection documents are superseded; day content versions remain 1 and content hashes equal current v4. Monday's four Menu POs use v4/day0 and content version4.

Serving Hub `materialiseExternalProductionOrder` returns duplicate when sourceVersion, sourceContentHash and status match, without comparing publication occurrence. This explains the retained references even though outbox delivery succeeded. No quantity/canonical dish discrepancy was found. Exact affected sites/dates/quantities are all Tue–Fri nonblank cells in the site table (19 POs, 5646 portions). Recommended safe next step: read-only provider/consumer contract review of same-content republishing and signed-release binding, then decide whether explicit compatibility evidence or a narrowly scoped code fix is necessary. Do not manually update those IDs, bump menu content versions or republish menus to force a match.

## Allergen and delivery blockers: owner actions, no repair performed

**BLOCKED — review/release availability.** All 28 existing DI packages (23 nonempty menu site/days and five legitimate empty days) report `state.cpu=unavailable`, exception `CPU_REVIEW_UNAVAILABLE`, `siteMenu.status=none`, empty CPU orderIds and no release lineage. Menu presence and `freshness=current/completeness=complete` do not mean a signed CPU packet is available. Twenty-five selected orders have no stored CPU plan; the sole existing plan belongs to the cancelled RCoA record. The published entry ledger below identifies exact affected dish/site/date/portion evidence; 94 rows are not confirmed. Unknown/unrecorded is not CLEAR. CPU projection allergenReadiness can say ready while these rows are unreviewed because the serving summary checks missing/conflicting blockers; do not use that label as release proof.

Safe action for the authorised kitchen reviewers: review the current Menu evidence, resolve unknowns from actual ingredients/supplier records, save/sign through the existing governed CPU process and verify current packet/site-menu delivery into DI before service. If CPU_REVIEW_UNAVAILABLE persists, authorise diagnosis of the read adapter/auth/packet propagation path first. This audit does not assume it is safe to fabricate a missing plan, mark blanks clear, reuse the cancelled plan, or run reconciliation. Any resulting code correction must have its exact scope leased separately; Delivered-In implementation is currently owned by haiku-iss-001.

**BLOCKED — delivery planning.** All twenty active requirements have one matching pending Logistics job. No date-scoped delivery loads exist, and the only runs found are two empty draft runs on Monday. Jobs' menu times are midnight placeholders, not proof of an agreed delivery appointment. Logistics operator must confirm actual required windows, routes, driver/vehicle and load assignments through authorised ordinary planning before dispatch. This is an operational owner action requiring its own authority; no route or state was changed. Dates/sites/quantities are the eighteen non-FX menu cells plus MNK 22 G&G items on Mon/Wed. Historical RCoA is excluded. No driver-view usability or driver entitlement was demonstrated.

**NOT VERIFIED — Brian.** Direct administrator data access and source inspection cannot establish Brian's login, entitlements or real workstation usability. Dispatcher supplied no new evidence. Brian must demonstrate his own read journey for the selected dates across Day/Week/Totals/Run Sheet and recognise the distinction between portions/items and review/release readiness. Do not grant new permissions on this audit's authority.

**DEFERRED — hardware and requested UI follow-ups.** Owner response: printing has not been tested and is deferred until Derek handles hardware. No printing work was pursued. The served Run Sheet has a print-whole-day path and printable/manual collection support; its loadWholeDay checks completeness and excludes withdrawn work. This source evidence is not a hardware test or an accepted manual operating procedure. Luna will separately receive the day-toggle selector and category-organised Totals requests. Manual fallback practicality remains NOT VERIFIED; nominate an operator and cross-check the sheet against current version/site/date/units after allergen sign-off if that fallback is chosen. It cannot replace safety review or delivery ownership.

## Published entry evidence ledger

Every row is a current published entry. Allocations use the exact OPLOC code mapping above; quantities are portions. This supports specific owner follow-up without renaming or merging dishes. `unreconciled` means the catalogue itself records local reconciliation incomplete, not that the ID is missing. SourceEntryId is the immutable publication entry reference.

| Date | Source entry | Canonical dish ID | Portions / allocations | Allergen evidence | Catalogue |
| --- | --- | --- | --- | --- | --- |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:cold-protein:1792742167157` | `menu-item:local:mikxed-chicken-protein-cold` | 60; OPT 30, FX 30 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:soup:1792742234588` | `menu-item:local:roasted-tomato-basil-soup-with-focaccia-croutons` | 15; FX 10, HAL 5 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:salad-1:1792742592562` | `menu-item:local:artichoke-new-potato-red-pepper-sun-dried-tomato-pesto` | 95; OAC 10, OPT 40, FX 25, HAL 20 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:salad-2:1792742629657` | `menu-item:local:marinated-courgette-ribbons-with-basil-grilled-artichokes` | 95; OAC 10, OPT 40, FX 25, HAL 20 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:salad-3:1792742663243` | `menu-item:local:baby-leaves-with-citrus-mint-dressing-shaved-fennel` | 95; OAC 10, OPT 40, FX 25, HAL 20 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:hot-main:1792743464985` | `menu-item:local:suffolk-chicken-roasted-with-lemon-thyme-confit-garlic` | 70; FX 40, HAL 30 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:vegan-main:1792743492288` | `menu-item:local:charred-kentish-aubergine-with-tahini-pomegranate-parsley-pesto` | 15; FX 10, HAL 5 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:cold-protein-2:1793012770898` | `menu-item:local:cajun-roasted-side-of-salmon-with-red-pepper-salsa` | 24; OPT 24 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:salad-5:1793096212810` | `menu-item:local:celeraic-carrot-and-red-cabbage-slaw` | 95; OAC 10, OPT 40, FX 25, HAL 20 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:starch-side-1:1793096665193` | `menu-item:local:herbed-couscous-with-golden-raisins` | 75; FX 40, HAL 35 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:starch-side-2:1793096693368` | `menu-item:local:steamed-spinach-with-roasted-red-peppers` | 75; FX 40, HAL 35 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:starch-side-3:1793096718489` | `menu-item:local:stone-baked-rosemary-focaccia-with-smoked-salt` | 60; FX 25, HAL 35 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:sauce-1:1793096747218` | `menu-item:local:orange-and-olive-salsa` | 50; FX 25, HAL 25 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:sauce-2:1793096762474` | `menu-item:rolling:tahini-dressing` | 25; HAL 25 | confirmed | unreconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:garnish-1:1793096817916` | `menu-item:local:pomegranate-seeds` | 25; HAL 25 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:garnish-2:1793096830187` | `menu-item:local:lemon-wedges` | 25; HAL 25 | unreviewed | reconciled |
| 2026-11-02 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:1:garnish-3:1793096841214` | `menu-item:local:fresh-herbs` | 25; HAL 25 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:cold-protein:1792742171093` | `menu-item:local:mikxed-chicken-protein-cold` | 75; OPT 30, CB 20, FX 25 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:soup:1792742253096` | `menu-item:local:roasted-red-pepper-coriander-soup` | 5; HAL 5 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:salad-1:1792743202300` | `menu-item:rolling:cucumber-ribbons-with-dill-pickled-radish` | 110; OAC 10, OPT 40, CB 20, FX 25, HAL 15 | confirmed | unreconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:salad-2:1792743230283` | `menu-item:local:wild-rice-pomegranate-salad-with-charred-sweetcorn` | 110; OAC 10, OPT 40, CB 20, FX 25, HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:salad-3:1792743261691` | `menu-item:local:spinach-with-sumac-vinaigrette-roasted-red-peppers` | 110; OAC 10, OPT 40, CB 20, FX 25, HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:salad-4:1792743269774` | `menu-item:rolling:mixed-fika-leaf-salad` | 50; OAC 10, FX 25, HAL 15 | confirmed | unreconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:hot-main:1792743519260` | `menu-item:local:wiltshire-lamb-kofta-with-cumin-paprika` | 75; FX 40, HAL 35 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:vegan-main:1792743545844` | `menu-item:local:fire-roasted-pepper-chickpea-stew` | 5; HAL 5 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:salad-5:1792755616066` | `menu-item:local:asian-slaw-with-coriander-and-spring-onion` | 85; OPT 40, CB 20, FX 25 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:salad-6:1792755733319` | `menu-item:local:artichoke-new-potato-red-pepper-sun-dried-tomato-pesto` | 85; OPT 40, CB 20, FX 25 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:cold-protein-2:1793012865744` | `menu-item:local:roasted-butternut-squash-blue-cheese-quince-tart` | 20; OPT 20 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:starch-side-1:1793096955404` | `menu-item:local:bariis-iskukaris-inspired-saffron-rice` | 40; HAL 40 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:starch-side-2:1793096975004` | `menu-item:local:grilled-courgette-with-basil-rocket-pesto` | 40; HAL 40 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:starch-side-3:1793096985285` | `menu-item:local:grilled-flatbread-brushed-with-za-atar-oil` | 40; HAL 40 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:sauce-1:1793097002078` | `menu-item:local:smoked-yoghurt` | 20; FX 5, HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:sauce-2:1793097012987` | `menu-item:local:tomato-caper-lemon-butter` | 15; HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:garnish-1:1793097027592` | `menu-item:local:fresh-coriander` | 25; FX 10, HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:garnish-2:1793097038079` | `menu-item:local:za-atar-oil` | 25; FX 10, HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:garnish-3:1793097066520` | `menu-item:local:pickled-red-onion` | 25; FX 10, HAL 15 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:starch-side-7:1793103459032` | `menu-item:local:jacket-potato` | 10; CB 10 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:starch-side-5:1793103499783` | `menu-item:local:jacket-filling-1` | 5; CB 5 | unreviewed | reconciled |
| 2026-11-03 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:2:starch-side-6:1793103504225` | `menu-item:local:jacket-2` | 5; CB 5 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:cold-protein:1792742178020` | `menu-item:local:mikxed-chicken-protein-cold` | 80; OPT 30, CB 20, FX 30 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:soup:1792742274097` | `menu-item:rolling:classic-minestronie-with-vegan-pesto` | 10; FX 5, HAL 5 | unreviewed | unreconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:salad-1:1792743298885` | `menu-item:local:charred-tenderstem-broccoli-lemon-sesame-toasted-almonds` | 140; OAC 10, OPT 40, CB 20, BP 30, FX 20, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:salad-2:1792743310984` | `menu-item:local:roasted-beetroot-apple-pickled-onion-british-beetroot-seasonal-apple-herbs` | 140; OAC 10, OPT 40, CB 20, BP 30, FX 20, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:salad-3:1792743324741` | `menu-item:local:greek-style-tomato-butter-bean-fennel-salad-tomato-butter-beans-shaved-fennel-oregano` | 140; OAC 10, OPT 40, CB 20, BP 30, FX 20, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:salad-4:1792743333474` | `menu-item:local:kale-miso-slaw-kale-cabbage-carrot-sesame-miso-dressing` | 140; OAC 10, OPT 40, CB 20, BP 30, FX 20, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:hot-main:1792743575282` | `menu-item:local:chargrilled-chicken-pesto-grilled-chicken-thigh-parsley-and-pumpkin-seed-pesto` | 145; BP 70, FX 40, HAL 35 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:fish-1:1792743592291` | `menu-item:local:harissa-roast-salmon-cold-or-hot-roasted-salmon-harissa-preserved-lemon-coriander` | 30; BP 30 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:vegan-main:1792743609889` | `menu-item:local:miso-glazed-tofu-vegan-roasted-tofu-miso-ginger-sesame` | 30; BP 20, FX 5, HAL 5 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:salad-5:1792755786674` | `menu-item:local:cucumber-avocado-herb-salad-cucumber-avocado-radish-herbs-citrus` | 110; OPT 40, CB 20, BP 30, FX 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:salad-6:1792755799643` | `menu-item:local:roasted-sweet-potato-date-dukkah-roasted-sweet-potato-dates-herbs-toasted-dukkah` | 110; OPT 40, CB 20, BP 30, FX 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:cold-protein-2:1793012917334` | `menu-item:local:hot-smoked-salmon-cr-me-fraiche-chive` | 2; OPT 2 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:starch-side-2:1793097161297` | `menu-item:local:herb-lemon-grains-pearl-barley-quinoa-parsley-lemon` | 100; BP 50, FX 20, HAL 30 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:starch-side-3:1793097215284` | `menu-item:local:sesame-brown-and-black-wild-rice-brown-rice-spring-onion-sesame-herbs` | 100; BP 50, FX 20, HAL 30 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:starch-side-1:1793097427771` | `menu-item:local:eedemamae-beans-edamame-beans-buckthorn-sea-salt-and-tonkatatu` | 100; BP 50, FX 20, HAL 30 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:garnish-1:1793097539486` | `menu-item:local:chilli-flakes` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:garnish-2:1793097556181` | `menu-item:local:toasted-pumpkin-seeds` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:garnish-3:1793097566606` | `menu-item:local:grated-hot-honey-carrot` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:garnish-4:1793097578084` | `menu-item:local:mint-and-coriander` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:sauce-1:1793098004950` | `menu-item:local:green-herb-tahini` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:sauce-2:1793098026893` | `menu-item:local:chimichurri` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:sauce-3:1793098037393` | `menu-item:local:harissa-yoghurt` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:sauce-4:1793098085708` | `menu-item:local:lemon-herb-dressing` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:sauce-5:1793098123891` | `menu-item:local:ginger-miso-dressing` | 80; BP 50, FX 10, HAL 20 | unreviewed | reconciled |
| 2026-11-04 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:3:starch-side-7:1793103468861` | `menu-item:local:jacket-potato` | 10; CB 10 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:cold-protein:1792742183172` | `menu-item:local:mikxed-chicken-protein-cold` | 80; OPT 30, CB 20, FX 30 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:soup:1792742371639` | `menu-item:local:moroccan-vegetable-lentil-soup` | 10; FX 5, HAL 5 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:salad-1:1792743359181` | `menu-item:rolling:roasted-courgette-mint-pesto-toasted-pinenuts` | 100; OPT 40, CB 20, FX 20, HAL 20 | confirmed | unreconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:salad-2:1792743383794` | `menu-item:local:citrus-fennel-slaw-with-celeriac` | 110; OAC 10, OPT 40, CB 20, FX 20, HAL 20 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:salad-3:1792743395312` | `menu-item:local:bulgur-tabbouleh-with-slow-roasted-peppers` | 110; OAC 10, OPT 40, CB 20, FX 20, HAL 20 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:salad-4:1792743401781` | `menu-item:rolling:mixed-baby-leaf` | 110; OAC 10, OPT 40, CB 20, FX 20, HAL 20 | confirmed | unreconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:hot-main:1792743777992` | `menu-item:local:slow-braised-british-beef-tagine-with-apricots-almonds-cinnamon` | 80; FX 40, HAL 40 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:vegan-main:1792743807437` | `menu-item:local:proven-al-ratatouille-with-white-beans` | 15; FX 10, HAL 5 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:salad-5:1792755776276` | `menu-item:rolling:shredded-kale-ceaser-with-all-the-trimmings` | 90; OAC 10, OPT 40, CB 20, FX 20 | unreviewed | unreconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:salad-6:1792755815033` | `menu-item:local:roasted-beetroot-salad-with-toasted-coconut-coriander-and-cumin` | 80; OPT 40, CB 20, FX 20 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:cold-protein-2:1793013240276` | `menu-item:local:smoked-mackerel-pickled-cucumber-horseradish` | 24; OPT 24 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:starch-side-1:1793098313389` | `menu-item:local:crushed-new-potatoes` | 85; FX 40, HAL 45 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:starch-side-2:1793098350385` | `menu-item:local:grilled-pita-bread` | 75; FX 30, HAL 45 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:starch-side-3:1793098363684` | `menu-item:local:buttered-green-beans-with-kalamata-olives` | 75; FX 30, HAL 45 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:garnish-1:1793098391708` | `menu-item:local:preserved-lemon` | 60; FX 20, HAL 40 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:garnish-2:1793098400265` | `menu-item:local:fresh-herbs` | 60; FX 20, HAL 40 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:garnish-3:1793098415395` | `menu-item:rolling:toasted-almonds` | 60; FX 20, HAL 40 | confirmed | unreconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:sauce-1:1793098433884` | `menu-item:local:olive-tapenade` | 50; FX 20, HAL 30 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:sauce-2:1793098453277` | `menu-item:local:chive-butter` | 30; HAL 30 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:starch-side-7:1793103475652` | `menu-item:local:jacket-potato` | 10; CB 10 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:starch-side-5:1793103509403` | `menu-item:local:jacket-filling-1` | 5; CB 5 | unreviewed | reconciled |
| 2026-11-05 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:4:starch-side-6:1793103513866` | `menu-item:local:jacket-filling-2` | 5; CB 5 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:cold-protein:1792742194583` | `menu-item:local:mikxed-chicken-protein-cold` | 50; OPT 30, FX 20 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:vegan-main:1792754732761` | `menu-item:local:proven-al-ratatouille-with-white-beans` | 40; MNK 40 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:fish-1:1792754762171` | `menu-item:local:pan-seared-scottish-cod-with-chive-butter` | 100; MNK 100 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:salad-4:1792755831782` | `menu-item:rolling:shredded-little-gem-and-rocket-salad` | 80; MNK 40, OPT 40 | unreviewed | unreconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:salad-3:1792755922309` | `menu-item:local:bulgur-tabbouleh-with-slow-roasted-peppers` | 80; MNK 40, OPT 40 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:salad-2:1792755924891` | `menu-item:local:citrus-fennel-slaw-with-celeriac` | 80; MNK 40, OPT 40 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:salad-1:1792755936841` | `menu-item:local:roasted-beetroot-salad-with-toasted-coconut-coriander-and-cumin` | 80; MNK 40, OPT 40 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:starch-side-1:1793098788578` | `menu-item:local:crushed-new-potato-s` | 140; MNK 140 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:starch-side-2:1793098818760` | `menu-item:local:grilled-pita-bread` | 140; MNK 140 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:starch-side-3:1793098828913` | `menu-item:local:buttered-green-beans-with-kalamata-olives` | 140; MNK 140 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:garnish-1:1793098854697` | `menu-item:local:preserved-lemon` | 70; MNK 70 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:garnish-2:1793098869681` | `menu-item:local:fresh-herbs` | 70; MNK 70 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:garnish-3:1793098888376` | `menu-item:rolling:toasted-almonds` | 70; MNK 70 | confirmed | unreconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:sauce-1:1793098932184` | `menu-item:local:olive-tapenade` | 70; MNK 70 | unreviewed | reconciled |
| 2026-11-06 | `rolling-week:2026-11-02:entry:rolling-week:2026-11-02:day:5:cold-protein-2:1793113174304` | `menu-item:local:crayfish-and-salmon-with-lemon-and-chive-cr-me-fraiche` | 25; OPT 25 | unreviewed | reconciled |

## Validation and limitations

- Successful read-only checks: release ledger/serving parity; Menu HTTP build identity; compressed package integrity; 240 Menu→Hub→CPU→DI allocation comparisons; Hub→fulfilment and fulfilment→job ID/version/hash/quantity/unit comparisons; six CPU package/projection comparisons; cancellation lineage; bounded duplicate/requiredBy compatibility reads; final selected-head freshness comparison.
- No synthetic operational fixtures, emulator writes, application tests/typechecks/builds or live booking submissions were required for this production-data audit. No code was modified. Documentation/workflow validation is recorded in the PR and #160 after this report is committed.
- Site completeness is relative to the authoritative published week and bounded submitted orders, not an external sales forecast or a promise all expected client work was entered. No assumed work on blank days. No claim that 28 materialised DI packages represent every possible site/date; the scope covers known published/ordered OPLOCs.
- Raw evidence timestamps/updates are retained privately; report contains only selected operational references and counts. No new recurring jobs, reads, listeners, costs, audit writers or application behaviour were introduced.
- No production source change, deployment, operational correction or integration decision is authorised by this report. Recommendation can change only after the remaining gates have new evidence.

Local evidence digests (SHA-256; raw files intentionally not committed):

| Private evidence file | SHA-256 |
| --- | --- |
| fika-gate0-prod-initial.json | `f1030bded1386ce434d133d2cc6f9744876ee08853cded7707b90fd313d8958a` |
| fika-gate0-menu.json | `a6d40c021f2178375f3ec41cfd26cc61235a9ac2e634cc6783b757eb547c1222` |
| fika-gate0-downstream.json | `89311ca390488960a21028f3d6b617f622ea1aae1542870abc5ecaad34b1d02e` |
| fika-gate0-packages.json | `1dc82ad89772ecca73df9b30cb84745d91890a6f2510a4cf4b0a2b810ec81e32` |
| fika-gate0-reconciliation.json | `0c1036148459d12cd5ad9330439ac9fd0ed3f655bb10037f9ad54e91c95fd2a9` |
| fika-gate0-final-details.json | `391917d37eb3db74f146e7b4117703848e0527617dce9610118138e22ace87d9` |
| fika-gate0-freshness.json | `99e061736031fd96e0c33c1ece51040eff41f265ce4bed78cd9daf5b047247ab` |
| fika-gate0-lineage.json | `5645a099d0696f6af2d3f0ecc998ca6959cc021916625c8349de8b6e0c398978` |
| fika-gate0-rcoa-lineage.json | `cb4f0bf1b465b6c50e866a2e94e2f52bf50cb8daa3edd8c0879866772f4713dd` |
| fika-gate0-serving.json | `f27e46ebae68aed6ae00e4b8c0eaca6786831064291b8e42464ea7150a60fed7` |
