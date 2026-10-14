# Hospitality portal source-provider identity — analysis and proposed design

Date: 2026-10-14. Task: Hospitality portal source-provider identity.

## Decision

**NO-GO for releasing a provider correction at this point. Stop before implementation.**

The defect is confirmed: Angel Court, CFC and Munich Re submissions are attributed to MNK. However, the provider string is also a Booking identity namespace, and the shared ingestion function accepts Calendar imports. A provider substitution alone is unsafe. This report completes the architecture/impact analysis and proposes a compatibility design; it does not implement it or amend staging mappings.

Recommended model: **Option C**, introducing the common application provider `hospitality-booking-platform` for new shared-application submissions, while explicitly retaining the existing identity namespaces and historical provider values. This is a proposed new provider identifier, not an existing governed identity. All five branded portal instances are part of the common application. Site identity belongs in `service.portalSiteId` and canonical `service.oplocId`; menu catalogue providers describe separate source evidence.

## Source and staging provenance

Fetched origin before investigation. Recorded `origin/main`: `008bed112381b6a0072785dd2b72fae7bb438c14`.

The user's explicit release-candidate branch instruction takes precedence over the repository's normal main workflow. Created `codex/hospitality-source-provider-analysis` from the existing release-candidate checkout `codex/rcoa-hospitality-menu-update`, starting SHA `de16f650d8003410d289f5c25f7dc8b69f7f6128`. No main merge or deployment.

Read-only App Hosting build metadata and Cloud Run revision metadata establish:

| App | Serving revision / App Hosting build | Source SHA |
| --- | --- | --- |
| Hub / staging OS | `fika-os-staging-build-2026-10-12-005` / `build-2026-10-12-005` | `27fac6c1ee5921b8175cfb626cf1ca8255d7c98a` |
| Hospitality | `fika-hospitality-staging-build-2026-10-13-003` / `build-2026-10-13-003` | `01e6f30563271c28a3a5446396bd078c0df47b16` |

Staging is not the release-candidate checkout. The deployed Hub source and current source both contain the provider fallback and provider-derived ID hash. Relevant differences include CPU propagation code in Hub and rejection/logging handling on Hospitality's generic route. Those differences were inspected, not changed. Staging Hospitality exposes `FIKA_RCOA_OPLOC_ID=oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2`.

## Origin and current meanings

The earliest tracked Hub implementation inspected, commit `713a0cb`, was an MNK pilot. The Hospitality README and legacy compatibility map describe a new React/Firebase portal referencing the MNK legacy workflow without calling its Apps Script, Sheets, Gmail or Calendar. It hardcoded `mnk-booking-platform`, the MNK v1 contract and an MNK Booking hash namespace. Other sites subsequently reused that payload and endpoint. RCoA added a separate contract, source provider and hash namespace; the remaining sites retained the MNK default.

Current fields and authorities:

| Field / concept | Actual use |
| --- | --- |
| `source.provider` | Ingress provenance; bridge actor and ingestion audit source. Currently also used as the deterministic Booking hash namespace by a parallel conditional. |
| `source.sourceBookingId` | Original portal request reference, trimmed on storage and hashing. Immutable source evidence. Calendar imports use `calendar:cpux@fikacatering.com:<eventId>`. |
| `source.contractVersion` | Accepted payload adapter format: `fika.booking-ingestion.mnk.v1` or `fika.booking-ingestion.rcoa.v1`. Set by Hub, not a browser-supplied provider. |
| `service.portalSiteId` | Portal instance key: `mnk`, `angel-court`, `cfc`, `munich-re`, `rcoa`. Hub also recognises selected legacy labels when the key is missing/unrecognised. |
| `service.portalSiteLabel` | Preserved submitted label; workspace submissions use the governed site's label. Display evidence, not canonical destination identity. |
| `service.oplocId` | Active canonical destination resolved at ingestion from governed source mappings. Required before new booking writes. |
| Governed source mapping | Provider/type/identifier tuple mapped to an OPLOC, with status, actor, time, version and durable governance audit. Provider is an open string in the command schema. |
| Menu `providerMappings` | Catalogue-source provider and source item ID. Providers are already distinct for each site's brochure/catalogue; they are not Booking ingress identities. |

The existing model combines an application/adapter name, a site-specific pilot name and an identity namespace. It does not consistently represent a site or external source system. The proposed model assigns `source.provider` the software/application channel meaning and keeps the other dimensions explicit. This interpretation is a design recommendation based on the shared application and separate portal keys, not a claim that the current schema already defines that separation.

## Active portal/site matrix

All five OPLOCs below were read directly by their canonical document IDs in staging `fika-os-dev` and verified as OPLOC, published, active. Portal labels are from current portal config; governed labels are the OPLOC approved names. Workspace payload labels can therefore differ from the portal config label.

| Site key | Portal label / governed label | Current Booking provider / contract | Canonical OPLOC | Confirmed staging source mappings | Menu provider |
| --- | --- | --- | --- | --- | --- |
| `mnk` | MNK / MNK | `mnk-booking-platform` / MNK v1 | `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f` | `rota`, `site-label`, `mnk` | `mnk-booking-platform` |
| `angel-court` | Angel Court / One Angel Court | `mnk-booking-platform` / MNK v1 | `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` | `rota/site-label/angel court`; two new MNK `site-label` mappings for `angel-court` and `one angel court` | `angel-court-hospitality-brochure` |
| `cfc` | CFC / CFC | `mnk-booking-platform` / MNK v1 | `oploc:0d8626f9-99bd-4dde-9471-191dd0abfb2e` | `rota/site-label/cfc` | `cfc-hospitality-brochure` |
| `munich-re` | Munich Re / Munich RE | `mnk-booking-platform` / MNK v1 | `oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701` | `rota/site-label/munich re`; no matching `munich-re` key in the bounded identifier query | `munich-re-generic-brochure` |
| `rcoa` | RCoA / RCoA | `rcoa-booking-platform` / RCoA v1 | `oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2` | `rcoa-booking-platform/provider-location/rcoa` | `rcoa-hospitality-brochure` |

MNK has a configured canonical OPLOC in portal config. RCoA uses its configured OPLOC plus an equality guard. The other three rely on governance. Funding Circle is a separate governed OPLOC (`oploc:4405b735-765a-4a87-87bd-196ed10ca00f`); the manager selection helper rejects treating it as MNK's configured canonical destination.

For every site, replacing the provider used in the hash changes Booking identity. Menu lookup does not read `booking.source.provider`; it selects the menu provider from the portal key. Non-MNK catalogues have server-owned brochure compatibility pricing until canonical mappings are promoted. MNK remains strict and uses its governed offering catalogue. Renaming those catalogue providers would break legitimate menu joins and is outside the proposed provenance change.

## Ingestion and downstream paths

1. `apps/hospitality-booking/app/ui/BookingPortal.tsx` submits all four non-RCoA sites to public `POST /api/bookings`, carrying `siteId` and `site`, without a source provider.
2. `apps/hospitality-booking/app/api/bookings/route.ts` forwards the payload to Hub `POST /api/bookings/mnk` using bridge authentication. The config's `bookingEndpoint` names do not select different canonical providers for these submissions.
3. RCoA has `RcoaBookingPortal.tsx` and `/api/bookings/rcoa`: server validates/reprices its request and forwards to the same Hub endpoint with the expected OPLOC header.
4. Hub route validates the payload and calls `ingestMnkBooking`. The transaction checks a deterministic Booking document first, then bounded catalogue/mapping reads and the target OPLOC. An existing document is returned without rewriting historical source evidence. New writes atomically include Booking, ingestion audit and notification obligation.
5. `buildMnkCanonicalBooking` misattributes non-RCoA bookings, bridge actors, status-history reason and ingestion-audit reason to MNK. `local-booking-fixtures.ts` repeats this attribution across sites, with independent `booking:fixture:*` IDs and synthetic fixture OPLOCs. Those fixtures are not governed staging destinations.
6. `cpu-calendar-runner.ts` calls the same `ingestMnkBooking` for Calendar/workbook imports. Its source ID is a calendar/event key; its site key is derived from candidate location. A blanket provider fix would misattribute these imports as public portal submissions. Its legacy item IDs also encounter the shared trusted-price/catalogue boundary; successful current import behaviour was not exercised.
7. Angel Court Gmail/local inbox workers store `angelCourtInboxCandidates` with `canonicalWrite: disabled`; they do not currently create canonical Bookings. Their source is Gmail/attachment evidence. They must not be presented as successful canonical portal ingestion.
8. Review/quote workflow loads Booking by canonical ID. Quote IDs, production requirement/order/line IDs, CPU source lineage, allergen release lineage, fulfilment and Logistics projections refer to those stable downstream IDs.

The provider-only change must not rewrite Calendar/import or historical provenance, menu/catalogue identity, existing Booking IDs or the associated quote/order/release identities.

## Identity compatibility analysis

Current `canonicalBookingId` hashes:

```text
SHA256("<mnk-booking-platform OR rcoa-booking-platform>:<trimmed sourceBookingId>")[0:32]
```

Prefix: `booking:mnk:` for all non-RCoA sites, `booking:rcoa:` for RCoA. Portal site key is not otherwise part of the hash. The new portal generates references with site prefixes, but callers are not required to use them; the same source reference supplied for two non-RCoA sites produces the same canonical ID. The existing-document fast path does not verify site agreement. This is a confirmed latent cross-site collision/replay risk, not evidence that an actual staging collision occurred.

Read-only hash reproduction for source reference `ANGEL-ONE`:

| Hash provider | Digest |
| --- | --- |
| `mnk-booking-platform` | `69a1b189cf46d80637fbe8663f2c23b3` |
| `hospitality-booking-platform` | `4b576c32f7a74163de5a72548cf9b987` |
| `angel-court-booking-platform` | `8da1cc376c797503a127e87320a7fc0c` |

| Concern | Provider dependency |
| --- | --- |
| Booking ID and ingestion replay | **Direct** through provider hash namespace. Changing the hashed provider misses existing documents. |
| Quote ID | **Indirect**: `quote:<canonicalBookingId>:r<revision>`. |
| Production Requirement | **Indirect**: `production-requirement:<bookingId>:<quoteRevisionId>`. |
| Production Order | **Indirect**: current `production-order:v1:<bookingId>[:r<bookingVersion>]`; older helper uses `production-order:<bookingId>`. |
| Production lines | **Indirect**: Booking ID and line ordinal. |
| CPU identity / projection / reuse | **Indirect**: Order canonical ID/version and canonical Booking/Quote lineage. The Production Order's `sourceBookingId` means canonical Booking ID, not the original portal reference. |
| Allergen release/signature lineage | **Indirect**: canonical Booking/Quote IDs, source versions/content hashes and matrix hash. |
| Fulfilment / Logistics | **Indirect**: canonical Production Order, destination OPLOC and versions/content hashes. |
| Notification/email dedupe | **Indirect**: `booking:<canonicalBookingId>:<kind>:<version>`. Site controls branding; Booking provider does not directly control notification identity. |
| Audit | **Direct attribution**, and indirect entity identity. Bridge actors use provider; audit documents also key from canonical Booking ID. |
| Menu lookup | No direct Booking-provider dependency. Catalogue provider comes from portal key; item provider mappings retain their own semantics. |
| OPLOC resolution | Currently **does not filter provider**. Non-RCoA selects the first confirmed identifier match with any nonempty entity type. RCoA requires exactly one `provider-location` candidate for key `rcoa`, also without provider filtering. |

A new provider must not be substituted into the existing hash. Equally, adding a second confirmed RCoA mapping before making resolution provider-aware would cause its exactly-one-candidate guard to reject. For other sites, conflicting confirmed mappings can produce order-dependent destinations. These are architectural reasons to stop before code/governance changes.

The general BookingPortal also creates a fresh source reference inside each submission attempt; it prevents concurrent sends but does not persist one reference across an uncertain-response retry. RCoA does persist a stable request reference. Changing this retry behaviour is a separate issue to account for in acceptance coverage, not a fix performed here.

## Classification of MNK assumptions

Repository search of apps, packages, tools, scripts and docs found the following files with the exact `mnk-booking-platform` token. Generated diagnostic output was excluded from architectural authority.

| Classification | Files / uses |
| --- | --- |
| Legitimately MNK catalogue-specific | `packages/server-shared/src/hospitality-catalogue/mnk-hospitality-menu.v1.json`; Hospitality `scripts/convert-mnk-menu.mjs`; Hub `lib/mnk-booking-catalogue.ts`, `fixtures/mnk-legacy-menu-import.candidates.json`, `scripts/convert-mnk-legacy-menu.mjs`, `scripts/load-mnk-legacy-menu-candidates.ts`; MNK branches of `hospitality-price-trust.ts` and menu helpers in `hospitality-booking-service.ts`. Preserve catalogue provider mappings. |
| Generic portal behaviour incorrectly named/attributed | Hub `hospitality-booking-service.ts` source-provider type/default, bridge actors/reasons and non-RCoA contract attribution; public/Hub MNK-named route and ingestion helper names serve other sites. Wire-contract reuse is legitimate; claiming MNK provenance is not. |
| Historical compatibility that must remain interpretable | `canonicalBookingId` hash namespaces; historical source values/contracts; Hospitality `README.md` and `docs/legacy-compatibility-map.md` explain the original pilot, not the full present architecture. |
| Incorrect cross-site fixtures / missing assertions | Hub `lib/local-booking-fixtures.ts` uses MNK for Angel Court/CFC/Munich Re. `tests/hospitality-booking-service.test.ts` covers their site/menu identity but lacks non-RCoA provider assertions. `tests/booking-notifications.test.ts` changes its MNK fixture into an RCoA display example without changing source provider. |
| Valid MNK test data / compatibility examples | Hospitality `tests/run-sheet.test.ts`; MNK portions of Hub `tests/booking-notifications.test.ts` and `tests/hospitality-booking-service.test.ts`. Preserve legitimate MNK historical evidence; adapt new-channel expectations deliberately. |
| Generic lifecycle integration test relying on MNK defaults | Hub `tests/booking-email-firestore.test.ts` uses an MNK menu provider with an unrecognised test site key. Its attribution relies on the default rather than an explicit MNK portal context; future integration fixtures need an explicit source/site context. This test writes Firestore and was not executed here. |

Additional canonical `booking:mnk:*` examples occur in Golden Week tooling, Production/CPU tests and shared menu-artifact tests. These are stable-ID examples and should not undergo blanket replacement. Menu-promotion scripts read catalogue `source.provider`, not Booking `source.provider`.

## Exact Angel Court staging mappings and audit

Both records remain at version 1, confirmed, provider `mnk-booking-platform`, type `site-label`, targeting `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10`:

| Identifier / source label | Mapping ID | Firestore document ID | Confirmed UTC |
| --- | --- | --- | --- |
| `angel-court` / Angel Court portal key | `source-mapping:c1a07263c6990c7c0ca1f5f6` | `453fc6cccdbed2607b616424017591ce2f0944688002a71f4eaf1a59ac1ecce3` | `2026-10-14T11:07:24.153Z` |
| `one angel court` / One Angel Court | `source-mapping:3a2beedeb1ebeba8897618b9` | `b7cd0de9b115ad558265129cfef6fcb27eabb52d0df4c1353ede369ac734806c` | `2026-10-14T11:07:26.343Z` |

`confirmedBy` and `updatedBy` on both: `FrEWXFAxXWQMxj8IfU5k6WJvFq13`.

| Mapping | Governance audit document / auditId | Actor | Audit timestamp UTC |
| --- | --- | --- | --- |
| `c1a07263c6990c7c0ca1f5f6` | `746dded6-c480-41b5-b42d-14afd0192832` / `984a4814-0426-479f-9f5e-72a8ed1af5b7` | Derek Buckley / same UID above | `2026-10-14T11:07:24.165Z` |
| `3a2beedeb1ebeba8897618b9` | `e7003cad-4e11-4577-8a28-6c002aada7fe` / `441e0cb4-2df1-44ec-a3d8-852f9aab0eb2` | Derek Buckley / same UID above | `2026-10-14T11:07:26.356Z` |

Action is `Source mapping decision`. Reasons confirm the current Angel Court identity against One Angel Court and preserve the existing Rota mapping. Existing `rota/site-label/angel court` is still confirmed: mapping `source-mapping:790693b3a54fddcf4a74f0c7`, document `24ca6af6e7503a3f27e495e6c85d052f1d4687fb6e93e3aa5dae150b652cc526`, confirmed `2026-07-29T16:30:57.112Z`.

`POST /api/governance` supports `historical`, `rejected`, `deferred` etc. Reposting the same provider/type/identifier updates its current projection, increments version and appends a new durable audit event in the same batch. Changing provider or entity type creates a different mapping identity; it does not rename or retire the old mapping. Old audit events remain. Current mapping confirmation fields are cleared for a non-confirmed status; historical audit retains the original action. Governance events carry a reason/entity/actor/time, not a complete structured prior mapping snapshot. Corrections should therefore cite old/new tuples and the supersession reason explicitly.

These two records should eventually be superseded through governance, not deleted or silently renamed. No mapping was mutated in this investigation.

## Proposed compatibility design and exact governance plan

1. Define a server-owned source context distinguishing shared portal submissions from Calendar imports. Never derive provenance solely from `siteId` or accept an arbitrary browser provider. Preserve the existing authenticated bridge and RCoA trusted request/expected-OPLOC boundary.
2. New portal submissions use `source.provider= hospitality-booking-platform`, regardless of branded site. Define the new application/provider version and payload-adapter contract explicitly; retain original accepted wire-contract evidence rather than relabelling old payloads. RCoA's distinct request adapter remains explicit.
3. Freeze existing Booking identity generation as a compatibility namespace. Record a separate identity scheme/namespace on new records: current MNK namespace for the four non-RCoA sites, current RCoA namespace for RCoA. Do not infer the ID namespace from the new provenance provider. Keep raw source references unchanged. Existing-document retries return historical records untouched; validate the stored portal/site agrees with the incoming request and fail closed on a collision. A future site-scoped ID scheme would require a separate versioned rollout and compatibility lookup, not this change.
4. Resolve new-channel destinations from exactly one confirmed tuple `(hospitality-booking-platform, provider-location, stable portal key)`, validate the canonical target/redirect authority and active state, and retain RCoA expected-ID equality. Display labels remain source/display evidence. Legacy adapters get an explicit compatibility policy; no first-match label fallback for the new channel.
5. Preserve menu-provider selection and canonical menu IDs exactly as shown in the matrix. Catalogue/brochure provenance is separate from application provenance.
6. Do not relabel historical Bookings, quotes, orders, audit events or signed releases. Old MNK/RCoA provider values remain supported for reads and retries. Do not change CPU reuse UAT state or run a broad migration.

After the new model/resolver is validated and its staging rollout is coordinated, the proposed authenticated governance commands are:

| Provider | Type | Identifier | Target | Action |
| --- | --- | --- | --- | --- |
| `hospitality-booking-platform` | `provider-location` | `mnk` | `oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f` | Confirm new stable portal mapping |
| `hospitality-booking-platform` | `provider-location` | `angel-court` | `oploc:24a93500-d75d-4fe0-8beb-672d36f9da10` | Confirm new stable portal mapping |
| `hospitality-booking-platform` | `provider-location` | `cfc` | `oploc:0d8626f9-99bd-4dde-9471-191dd0abfb2e` | Confirm new stable portal mapping |
| `hospitality-booking-platform` | `provider-location` | `munich-re` | `oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701` | Confirm new stable portal mapping |
| `hospitality-booking-platform` | `provider-location` | `rcoa` | `oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2` | Confirm new stable portal mapping |
| `mnk-booking-platform` | `site-label` | `angel-court` | Existing Angel Court OPLOC | Mark historical; cite replacement mapping and original audit |
| `mnk-booking-platform` | `site-label` | `one angel court` | Existing Angel Court OPLOC | Mark historical; label retained as evidence, new ingress resolves by key |

Keep `rota/site-label/angel court` and the other Rota mappings. Keep the old RCoA provider mapping for historical adapter compatibility. Do not execute this table against the current resolver: duplicate RCoA candidates would break submissions, and retiring Angel Court mappings before the replacement resolver/mapping is usable could reintroduce its 422. The current API applies one mapping command at a time; rollout sequencing must be deliberate and use authenticated governance, with actor/audit verification after each decision. No direct Firestore writes.

Why this model: one application provider is truthful for the shared software, avoids a provider per branded site and preserves separate site authority. Pure Option A with a new hashed provider or Option B with per-site hash providers would break replay identity. Option C makes compatibility explicit instead of rewriting the past. This is the recommended design for review; its implementation safety remains to be established by regression coverage and rollout validation.

## Existing staging population and migration scope

Read-only filtered queries with selected identity/provenance fields and limit 101 returned 12 records without reaching the cap: 10 MNK and 2 RCoA. Every result had a canonical OPLOC, expected site key and corresponding existing provider/contract. A second query by the two existing provider values returned the same 12 and no unscoped records. Angel Court, CFC and Munich Re had zero records in these scopes.

This is not an assertion about records with a different source provider, nor a whole-production audit. No historical booking backfill is justified by these results. The proposed correction requires seven bounded governance decisions, not a booking migration. Historical fixture records are local evidence, not staging population. No production records were read or changed.

## Validation and remaining release gates

Commands actually run:

- Hub: `.\node_modules\.bin\tsx.cmd --test tests/hospitality-booking-service.test.ts tests/booking-workflow.test.ts tests/booking-notifications.test.ts` — **32 passed, 0 failed**.
- Hospitality: `.\node_modules\.bin\tsx.cmd --test tests/mnk-contract.test.ts tests/workspace-routing.test.ts tests/rcoa-portal.test.ts` — **41 passed, 0 failed**.
- Read-only crypto reproduction proves different provider strings produce different digests.
- Read-only App Hosting/Cloud Run provenance, bounded staging mapping/audit/Booking queries and five direct canonical OPLOC reads.

These are baseline checks, not proof of a fix. No new tests or production code were added. No emulator integration mutation, public submission, quote, production handoff or live downstream smoke was performed. Typechecks and builds were not run because implementation stopped at the requested architecture checkpoint. The full Hub test suite includes Firestore-writing integration tests; it was not run against shared UAT state.

Required implementation acceptance: new-channel provenance and frozen IDs for MNK, Angel Court, RCoA and CFC/Munich Re; unchanged historical retries; site-mismatch collision rejection; deterministic provider-scoped OPLOC mapping; missing/ambiguous/inactive destinations fail closed; unchanged menu providers; isolated idempotent Production Order creation and unchanged quote/CPU/release/fulfilment identities; Calendar provenance isolated; live staging submission/load/review after governed mapping rollout; focused Hub/Hospitality tests, typechecks and builds. General-portal uncertain-response retry handling must be explicitly assessed.

Runtime consumers whose contracts must be checked: Hospitality provider/Hub reader, Hub ingestion/workflow/catalogue/governance/production/notification boundaries, CPU order/release lineage and shared Fulfilment/Logistics projections. No downstream identity rewrite is proposed.

Files changed for this checkpoint: this report and root CHANGELOG only. No implementation change applied. No push, merge, staging mutation, backfill, production deployment or CPU reuse UAT change.
