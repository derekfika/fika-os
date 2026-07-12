# FikaBooking v1 Formal Architecture and Domain Review

> **Classification: Supporting historical review.** Its blocking decisions have now been answered in the canonical decision register. The recommendations remain evidence, but no schema revision or adoption is implied.

## Review status

- **Schema reviewed:** `FikaBooking` `1.0.0-draft.1` and its draft item, customer, service-location and charge value objects
- **Review outcome:** **Sound basis; revise before adoption**
- **Adoption status:** Not adopted
- **Review date:** 2026-07-11

The aggregate boundary is sound. `FikaBooking` should remain the authoritative commercial and service-intent record produced by the Hospitality Booking Platform and consumed through versioned contracts. The draft correctly separates dashboard workflow, production work, projections and legacy ingestion evidence.

The draft should not be adopted unchanged. A focused revision is required after the minimum blocking decisions in this review. No production implementation, migration, repository or storage choice is approved by this outcome.

## Evidence and review method

The review applies the platform principles, current/target architecture, ADR-003, ADR-004, confirmed Booking Platform and Hospitality Dashboard behaviour, CPU downstream evidence, storage independence, future configuration direction, and the Stage 2 architecture/testing/Definition of Done gates.

Each major area is classified using the requested outcomes. “Blocked by business decision” means the schema cannot safely settle the relevant semantics without an owner decision. It does not mean the overall aggregate boundary is unsound.

## Direct answers

### Is FikaBooking the authoritative commercial/service record?

Yes. `FikaBooking` is the authoritative versioned record of the hospitality booking's commercial and service intent: identity, commercial status, requesting site, customer/contact snapshot, requested service, ordered items, pricing snapshot, charges, dietary declarations, acknowledgements, source provenance, validation and record audit metadata.

Dashboard Sheets, Calendar events, quotes/documents, CPU Orders, production workflow and integration logs are not authoritative booking records.

### Which fields may dashboards amend directly?

Dashboards may directly update only dashboard-owned operational state outside `FikaBooking`, such as review/readiness presentation, stale indicators, print/archive state, projection diagnostics and other explicitly defined dashboard workflow fields.

No canonical booking field should be changed authoritatively by directly editing a dashboard projection. A dashboard may submit a governed command to the authoritative booking workflow. Whether particular roles may submit that command remains TODO.

### Which changes require a governed booking amendment?

Any authoritative change to customer/contact facts, commercial reference, service date/time/type/location, guest count, onsite contact, ordered items, quantities, choices, item comments, dietary declarations, customer/service instructions, acknowledgements, pricing, charges, tax, or commercially meaningful status requires a governed, version-checked mutation. Cancellation and decline should use explicit lifecycle commands rather than projection edits.

Pure dashboard state, production preparation state, integration retry state and parser diagnostics are not booking amendments.

### Should pricing remain immutable after submission, or versioned through amendments?

The submitted price snapshot for each historical booking version should be immutable. A governed commercial amendment may create a new booking version with a newly calculated, complete price snapshot; it must never mutate the prior snapshot in place. The exact repricing triggers, approval rules, effective point, quote relationship, credits/refunds and customer communication are blocked by business decision.

### Does the generic charge model remain appropriate?

Yes. The generic collection with `management_fee`, `delivery`, `labour`, `equipment`, `service_charge`, `discount` and `other` remains appropriate and supports confirmed variation without site-specific fields. Clarify booking-level versus item-targeted adjustments, tax/rounding treatment and post-submission changes before adoption. Physical labour/equipment allocation belongs to other domains; the charge represents only commercial value.

### What timing fields are required now versus deferred?

Required now: service date, a clearly defined primary requested time, time zone, and optional item-level service time where multiple services exist. An end time can remain optional when its meaning is confirmed.

The current `startTime` name is ambiguous across service, delivery, arrival and CPU usage and must be clarified or revised. CPU-ready, dispatch, route, production deadline and handover timings belong in Production or Logistics unless the business explicitly confirms one is part of the customer's service request.

### What quantity/unit information must be added for production compatibility?

`quantity` alone is insufficient. Each booking item needs an unambiguous ordered unit/measure and a structured submission-time serving/yield statement where the commercial item represents platters, packages, portions or people served. Exact field names and allowed units require business/catalogue ownership; free-text `servingInfoSnapshot` may remain a display snapshot but cannot carry the production contract alone.

Production quantity, batch size, yield conversion, work centre and preparation unit belong on future `FikaProductionLine`, derived from the ordered quantity/unit and a versioned conversion rule.

### How should dietary requirements reference individual booking items?

The draft booking-level counters are useful but insufficient for CPU line allocation. A future revision should support explicit allocation to stable `bookingItemId` values, while retaining genuinely booking-wide declarations and free text. The business must decide whether counts can overlap, whether a person-level requirement may affect several items, and how unknown/unallocated legacy declarations are represented.

Do not infer allocation from parser keywords or apply counts automatically without confirmed rules.

### How should quote, Calendar, production-order and audit relationships be represented?

- **Quote:** separate versioned record or document workflow linked by stable booking ID/version. A booking view may expose a derived summary, but provider URL/file state does not belong in the aggregate.
- **Calendar:** separate projection/integration record linked by booking ID/version; provider IDs and links belong in adapter metadata.
- **Production order:** separate canonical aggregate linked by source booking ID/version. The booking does not need to own production-order state.
- **Audit:** separate immutable history/event stream or repository capability keyed by booking ID/version. `createdAt/By` and `updatedAt/By` remain on the current aggregate; full history should not be embedded as a mutable array.

### Which fields must never be added to FikaBooking?

- dashboard row/column coordinates or projection-specific booleans/statuses;
- CPU `READY`/attention/prepared/completed state, chef attribution, production quantities, yields, categories or photographs;
- quote/Calendar/Drive URLs, provider object IDs, stale/printed/removed flags or UI state as first-class fields;
- Gmail subject/from, raw messages, attachment names, parser row positions, fingerprints or warnings as canonical business facts;
- raw `ItemsJSON`, `ParsedJSON` or duplicated legacy object shapes;
- recharge formulas/destination state, feedback state, branding, recipients, deployment information or secrets;
- presentation-only menu order/layout or demo-only behaviour.

### What legacy information must remain available outside the canonical aggregate?

Retain stable email message/thread references, attachment hashes, source document references, original files according to retention policy, parser/adapter version, mapping diagnostics, raw-field provenance, revision/fingerprint evidence, ingestion attempts, warnings and manual reconciliation outcomes in integration/audit storage. Only stable source references and carefully bounded provider metadata belong in `source`; raw content should not be copied into the aggregate.

### Can direct and email-derived bookings conform to the same contract without losing provenance?

Yes. Direct and Angel Court email-derived bookings can share the same aggregate. `source.channel`, stable references, received time, source system and integration/audit metadata preserve provenance. Legacy adapters may omit unresolved catalogue IDs, leave acknowledgements empty, and emit validation issues rather than invent facts. The canonical contract must allow honest uncertainty without weakening direct-platform validation.

## Major-section review

| # | Schema section | Classification | Review and recommendation |
|---:|---|---|---|
| 1 | Schema identity and versioning | Accept with clarification | Draft schema IDs and `schemaVersion` establish versioned contracts. Define adoption-status vocabulary, compatibility rules and whether embedded value-object versions advance independently. |
| 2 | Booking identity | Accept with clarification | Stable `bookingId` is correct. Approve generation, uniqueness scope, immutability and legacy assignment rules outside the schema where possible. Do not derive identity from row, Calendar or email display data. |
| 3 | Commercial booking status | Blocked by business decision | The enum is a credible initial set, but transition graph, owners, eligibility and meaning of `acknowledged`, `quoted` and `completed` must be approved. Keep dashboard/CPU status separate. |
| 4 | Source and ingestion metadata | Revise before adoption | Provider-neutral envelope and stable references are correct. Remove duplication/ambiguity between top-level `submissionId`/`idempotencyKey` and typed `references`, define cardinality/uniqueness, and constrain metadata/retention. |
| 5 | Customer structure | Accept with clarification | A submission-time snapshot and optional future `customerId` are sound. Confirm contact versus organisation roles, whether all contact fields remain required for every permitted channel, and retention/redaction. |
| 6 | Service location | Accept with clarification | Stable optional ID plus structured snapshot/display label supports current dashboards and storage independence. Clarify `siteId` duplication with the root, external/delivery location semantics and address/instruction ownership. |
| 7 | Service dates and times | Revise before adoption | Date/time/time-zone approach is sound, but `startTime` is semantically ambiguous. Define primary requested time, optional end, item service times and boundary with production/logistics timings. |
| 8 | Booking items | Accept with clarification | Stable line IDs, optional catalogue IDs and frozen descriptive/choice/comment snapshots fit direct and legacy paths. Clarify category authority, choice structure, bespoke empty-item rule and item validation lifecycle. |
| 9 | Ordered quantities and units | Revise before adoption | Integer `quantity` without a unit/measure is insufficient downstream. Add structured ordered unit/measure and serving/yield snapshot semantics; production conversion remains outside booking. |
| 10 | Pricing snapshots | Accept with clarification | Complete server-authoritative minor-unit snapshot is correct. Historical snapshots must be immutable; governed amendments create a new version/snapshot. Exact repricing policy remains a blocker. |
| 11 | Charges | Accept with clarification | Generic typed collection remains appropriate. Clarify booking-level/item allocation, `other` governance, discount rules and amendment/refund use. Do not model physical labour/equipment here. |
| 12 | VAT and rounding | Blocked by business decision | Basis points and tax lines are a sound representation, but rounding level, inclusive pricing, mixed rates, adjustments and legacy unknown tax require approved rules and arithmetic tests. |
| 13 | Totals | Accept with clarification | Item, charge, net, tax and gross totals are appropriate frozen values. Enforce arithmetic/currency invariants outside JSON Schema and decide treatment of negative totals/refunds. |
| 14 | Dietary and allergen information | Revise before adoption | Structured counts improve current flattened text, but need item allocation, overlap semantics, legacy unknown/unallocated representation and handling of severe allergies/free text. |
| 15 | Acknowledgements | Accept with clarification | Policy version, time, actor and optional wording snapshot are correct. Define required acknowledgement types/wording and which legacy records may progress without evidence. Never fabricate acceptance. |
| 16 | Audit metadata | Accept with clarification | Aggregate creation/update actors/timestamps are correct. Full immutable mutation/ingestion/effect history belongs in a separate audit capability linked by booking ID/version. |
| 17 | Optimistic concurrency | Accept with clarification | Persisted `version` and mutation `expectedVersion` boundary are correct. Define conflict results, command envelope, retry/rebase policy and whether every status change increments version. |
| 18 | Amendments | Blocked by business decision | A governed versioned amendment model is required but absent. Define amendable fields, actor permissions, repricing, acknowledgement, effective time, downstream propagation and immutable history. |
| 19 | Cancellations | Blocked by business decision | `cancelled` status is valid, but reason, actor/time, transition eligibility, downstream disposition, already-prepared handling and reversal/rebooking rules require decisions. Cancellation should be a governed command/history event, not a dashboard edit. |
| 20 | Quote relationships | Move to another domain | Quotes/documents should be separate records/workflows keyed to booking ID/version. Avoid provider links and UI state in `FikaBooking`; a read model may join a summary. |
| 21 | Calendar relationships | Legacy/integration metadata only | Calendar is a current projection/transitional envelope. Stable provider references and sync state belong in adapter/integration records, not canonical booking fields. |
| 22 | Production relationships | Move to another domain | Future production orders/lines link to source booking ID/version. CPU readiness, prep state, production quantities and conversion rules do not belong in `FikaBooking`. |
| 23 | Dashboard workflow state | Move to another domain | Dashboard operational status and projection state remain dashboard-owned. Canonical changes must use governed booking commands. |
| 24 | Legacy parser metadata | Legacy/integration metadata only | Retain source evidence, parser version, fingerprints, warnings, raw mapping and reconciliation outside the aggregate. Only bounded source references/metadata cross the canonical boundary. |
| 25 | Personal-data retention | Blocked by business decision | The aggregate necessarily contains contact data and may reference sensitive dietary/allergy information. Define purpose, access, retention, redaction/deletion, audit and legacy-source handling before adoption. Most policy can be external, but it constrains required fields and metadata. |
| 26 | Storage and projection boundaries | Accept as drafted | The model is storage-independent; Sheets, Calendar, documents and downstream views are projections/adapters. Select repository/storage only after contract and operational requirements are confirmed. |

## Decision table

| Topic | Current draft | Evidence | Recommendation | Decision owner | Status | Blocking impact |
|---|---|---|---|---|---|---|
| Aggregate authority | Booking is authoritative commercial record | Confirmed target flow, ADR-003 and both hospitality audits | Accept | Derek/business owner | Confirmed | None |
| Schema/version identity | Draft schema and value-object versions; root record `version` | Platform schema rules and concurrency decision | Clarify compatibility/adoption rules | Architecture owner: TODO | Open | Does not block next field revision |
| Booking ID | Stable required string | Direct platforms generate booking IDs; legacy needs stable canonical identity | Accept; decide uniqueness/generation policy | Architecture + operations: TODO | Open | Non-blocking for next revision |
| Status transitions | Eight commercial values, no transition graph | Dashboard and CPU statuses confirmed separate | Approve meanings, transition owners and graph | Derek/business owner | Open | Blocks lifecycle revision/adoption |
| Source reference shape | Channel/system/time, duplicated direct IDs and references | Direct idempotency and legacy stable-source requirements | Choose one canonical reference representation and uniqueness rules | Architecture owner: TODO | Open | Blocks source-envelope revision |
| Customer required fields | Name, email, phone and organisation required | Confirmed direct-platform validation | Retain snapshot; confirm channel exceptions and contact roles | Derek/operations | Open | May block required-field revision |
| Site/location relationship | Root `siteId`, optional location `siteId`, structured snapshot | Site configuration target; dashboards/CPU currently infer strings | Define requesting site versus service-location site semantics | Derek/operations + architecture | Open | Blocks precise location revision if multi-site/external cases exist |
| Primary service time | `serviceDate`, `startTime`, optional `endTime`, item `serviceTime` | Direct booking inputs and CPU delivery/service distinction | Define customer-requested time vocabulary and domain boundary | Derek/operations | Open | Blocks timing revision |
| Ordered unit | Integer quantity plus free-text serving info | CPU cannot determine platter/portion/person semantics reliably | Add structured ordered measure/serves snapshot | Derek/CPU + catalogue owner: TODO | Open | Blocks item revision |
| Production conversion | Not represented | ADR-004 assigns production quantities/yields to production lines | Keep outside booking; link by item ID/version | Production owner: TODO | Direction confirmed | Does not block booking once ordered unit is clear |
| Pricing immutability | One complete current snapshot | Direct platforms price server-side; downstream needs frozen facts | Preserve every version's snapshot; amendment creates new snapshot | Derek/commercial owner | Open | Blocks amendment/pricing revision |
| Generic charges | Seven generic charge types | Confirmed fee/delivery variation and ADR direction | Retain; clarify allocation and `other` governance | Derek/commercial owner | Open | Non-blocking if booking-level only retained |
| Tax and rounding | Tax lines/basis points; arithmetic invariants documented | Current variant calculations; rules unresolved | Approve rounding/inclusive/mixed-rate rules and add business validation | Finance/commercial owner: TODO | Open | Blocks pricing adoption/revision |
| Dietary allocation | Booking-level counters/free text only | Direct collection plus CPU line-allocation need | Add optional explicit booking-item references and unallocated legacy state | Derek/operations/CPU | Open | Blocks dietary revision |
| Acknowledgements | Version/time/actor; optional wording | Direct platforms confirm policies; legacy may lack evidence | Define mandatory types/wording and progression rules | Derek/compliance/operations: TODO | Open | Non-blocking for structural revision; blocks adoption policy |
| Validation lifecycle | Current result stored in aggregate | Legacy uncertainty and policy recalculation differ | Separate submission validation snapshot from later review/revalidation evidence | Architecture + operations: TODO | Open | Recommended before adoption; may be revised later |
| Concurrency commands | Root version; reusable expected-version definition | Confirmed optimistic concurrency decision | Define mutation envelope and conflict/retry response | Architecture owner: TODO | Open | Blocks mutation contract, not aggregate field revision |
| Amendments | No explicit amendment model | Dashboards currently edit projections; CPU needs ordered changes | Define command/history, permitted fields, repricing and propagation | Derek/business owners | Open | Blocks lifecycle/pricing adoption |
| Cancellations | Status value only | Dashboard workflows and CPU cancellation gap | Define cancellation event metadata and downstream disposition outside/alongside current aggregate | Derek/operations/CPU | Open | Blocks lifecycle adoption |
| Quote relationship | Deliberately excluded | Quote generation is downstream workflow | Separate quote aggregate/projection by booking ID/version | Architecture + commercial owner: TODO | Direction confirmed | Non-blocking |
| Calendar relationship | Deliberately excluded | Calendar is operational projection/CPU adapter | Separate integration record; never first-class link/URL field | Architecture owner: TODO | Direction confirmed | Non-blocking |
| Production relationship | Deliberately excluded | ADR-004 and CPU audit | Separate production aggregate keyed to booking ID/version | Production owner: TODO | Direction confirmed | Non-blocking |
| Audit history | Only root create/update metadata | Need traceable amendments, ingestion and effects | Separate immutable audit history keyed by booking/version | Security/operations: TODO | Open | Blocks adoption/recovery design, not next field revision |
| Personal-data retention | No retention/redaction policy in schema | Customer, contact, dietary and legacy evidence | Define policy and constrain metadata; do not embed raw sources | Data/business owner: TODO | Open | Blocks adoption; only blocks revision if fields change |
| Storage | Not selected | Storage independence principle and target architecture | Retain repository abstraction; defer implementation choice | Architecture owner: TODO | Deferred deliberately | None |

## Historical minimum decisions — now resolved

These decisions blocked revision when the review was written. They are now canonical and must be traced through BDRs before the schema is revised.

Only the following decisions materially determine the next schema shape:

1. **Service-time vocabulary:** decide what the booking's primary time means and whether customer-requested delivery/arrival and service times require separate fields; keep production-ready/dispatch timings downstream.
2. **Ordered quantity semantics:** approve the minimum structured unit/measure and serving/yield snapshot required on each booking item, including platter/package/person-served cases.
3. **Dietary allocation:** decide how booking-level requirements reference `bookingItemId`, whether counts may overlap, and how unknown or unallocated legacy requirements are represented.
4. **Pricing through amendments:** decide whether every commercial amendment recalculates a complete snapshot, which changes trigger repricing, and how previous snapshots remain immutable.
5. **Tax and rounding:** approve calculation/rounding level, inclusive pricing, mixed-rate handling and treatment of unknown legacy tax.
6. **Lifecycle and mutation model:** approve status meanings/transition ownership and whether amendments/cancellations are represented through a separate command/history contract while the aggregate stores only current status/version.
7. **Source-reference representation:** choose whether direct submission/idempotency values appear only as typed references or also as dedicated fields, and define uniqueness/cardinality.

All require Derek or the named business/operational owner. Exact production policy must not be inferred from current implementation.

## Non-Blocking Decisions

These may be deferred without weakening the next draft, provided their boundary remains explicit:

- physical repository and storage technology;
- final booking ID generation algorithm, if stable opaque identity remains required;
- future customer-master and service-location-master resolution;
- quote schema and document repository design;
- Calendar adapter/provider record design;
- production-order schema details beyond booking ID/version and booking-item traceability;
- dashboard workflow-state schema;
- Logistics timing/routing design;
- shared-package or implementation technology choices;
- exact audit storage mechanism, if immutable version/event requirements are retained;
- reporting projections and UI summaries;
- branding and public-experience presentation;
- item-level charge allocation if v1 explicitly remains booking-level;
- refunds/credits if explicitly deferred from v1 and unsupported statuses/operations are rejected;
- final retention durations, provided the next draft avoids raw legacy data and metadata remains constrained. Retention policy is still required before adoption.

## Fields recommended for revision

This review recommends revising concepts, not prescribing final production names:

- clarify or replace `service.startTime` with approved customer/service timing semantics;
- review `service.endTime` against the same vocabulary;
- add structured ordered quantity unit/measure to `FikaBookingItem`;
- add structured serving/yield snapshot sufficient to interpret the ordered unit, without adding production conversion;
- add dietary allocation capable of referencing stable `bookingItemId` values and representing unallocated legacy declarations;
- simplify `source.submissionId`, `source.idempotencyKey` and `source.references` into one non-duplicative contract;
- clarify `service.location.siteId` versus root `siteId`;
- clarify validation as submission-time snapshot versus later revalidation/review evidence;
- document historical pricing immutability and versioned amendment replacement of the current `pricingSnapshot`;
- constrain generic `metadata` objects or replace them with deliberately owned extension points where evidence supports them;
- define arithmetic, currency, VAT and rounding validation outside structural schema.

## Fields recommended for exclusion

Do not add first-class fields for:

- dashboard workflow/readiness/staleness/print/archive/recharge state;
- CPU status, preparation, production quantities/units/yields/categories, chef identity or evidence photos;
- quote, Calendar, file or dashboard provider URLs/IDs and sync flags;
- raw email/form/document content, attachment names, subjects/from values, parser rows, fingerprints or warnings;
- operational projection row numbers, headers, formula state or duplicated JSON blobs;
- notification delivery state, feedback state or reporting caches;
- branding, presentation, recipients, deployment configuration or secrets;
- mutable embedded audit-history arrays.

## Adoption gate

After the seven minimum decisions are made, a revised draft may be produced and validated against updated direct and legacy fixtures. Adoption still requires:

- approved field names and policies from operational/commercial stakeholders;
- mutation-envelope and lifecycle/amendment contracts;
- arithmetic/tax validation tests;
- representative regression fixtures for direct MNK, direct Angel Court and supported Angel Court legacy layouts;
- dashboard and CPU consumer contract tests;
- personal-data access/retention/redaction policy;
- migration, compatibility, reconciliation, rollback and recovery plans;
- an explicit adoption decision. Schema validation alone does not constitute adoption.

## Recommended next prompt

```text
Read the FikaBooking v1 formal review and all evidence it cites.

Do not modify schemas, fixtures or production code.

Facilitate and document decisions for the seven topics in “Minimum Decisions Required Before Schema Revision”: service-time vocabulary, ordered quantity semantics, dietary item allocation, pricing through amendments, tax/rounding, lifecycle/mutation representation, and source-reference representation.

For each topic, present confirmed evidence, 2–3 technology-neutral options, operational consequences, a recommended default, and the exact decision required from Derek or the named owner. Do not select policy on their behalf.

Write docs/schema-reviews/fika-booking-v1-decision-workshop.md. Do not produce a revised schema.
```
