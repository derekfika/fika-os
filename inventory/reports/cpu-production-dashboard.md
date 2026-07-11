# CPU Production Dashboard

## Status and evidence boundary

This is a read-only audit of `C:\FIKA\shared\cpu-dashboard` and its order-ingestion code as inspected on 11 July 2026. It tests the draft `FikaBooking` v1 model against the current CPU workflow. The draft schemas remain unadopted and were not changed. Lifecycle, users, production deployment, volumes, service levels and business criticality remain TODO unless already confirmed elsewhere.

No secret, identifier, private URL or customer record is reproduced here.

## Application structure

The CPU Production Dashboard is a Google Apps Script HTML-service application linked through local clasp configuration. It also contains a local Node preview helper; that helper is not evidence of a production Node service.

| Area | Files | Responsibility |
|---|---|---|
| Runtime configuration | `00_Config.js` | Sheet columns, workflow statuses, calendars, sites, production categories, scan limits and feature settings |
| Sheet setup | `01_Setup.js` | Creates/repairs Settings, Orders, Deliveries and Scan Log tabs |
| Ingestion adapters | `02_AttachmentParser.js` | Classifies attached/linked files; prefers booking JSON; parses quote and booking-form fallbacks; normalises fields and line items |
| Projection store | `03_DataStore.js` | Upserts CPU order/delivery rows, preserves workflow state, records detected changes and serves range-filtered data |
| Calendar ingestion | `04_CalendarScanner.js` | Lists events, detects booking/delivery events, performs incremental or deep scans and records scan jobs |
| Web application service | `05_Webapp.js` | Dashboard payload, refresh, order edits, quote reparse, prep/allergen photo upload and health endpoint |
| Regression harness | `06_TestHarness.js`, `qa/` | Parser and workflow regression cases |
| Browser application | `Index.html`, `Script.html`, `Styles.html` | Calendar/run-sheet/dietary/delivery/kitchen views, filtering, production aggregation and order drawer |
| Manifest and local tooling | `appsscript.json`, `.clasp.json`, `.claspignore`, `preview-server.js`, `package.json` | Apps Script linkage and local preview support |

Large or overloaded files include `02_AttachmentParser.js` (about 41 KB), `Script.html` (about 93 KB) and `Styles.html` (about 40 KB). They combine multiple parsing, application-state or presentation concerns and therefore carry regression risk.

## Current booking-to-production path

```text
Hospitality workflow creates or updates a Calendar event
  -> CPU scanner lists configured Calendar events
  -> event and description links are classified
  -> attached booking JSON is preferred
  -> quote and legacy booking-form parsers supply fallback data
  -> sources are merged in JSON, quote, form, title precedence
  -> a normalised CPU order projection is upserted to CPU Orders
  -> browser groups projected items into production totals and site splits
```

This is not yet the target direct contract `FikaBooking -> CPU`. Calendar is both the discovery envelope and part of the current identity/version mechanism. The booking JSON normaliser expects an earlier nested production shape, not the draft 2020-12 `FikaBooking` schema.

### Ingestion paths

1. **Preferred current path:** Calendar event plus a recognised booking JSON attachment. JSON supplies booking facts; the Calendar event still supplies order identity, event date/time envelope, site resolution context and change version.
2. **Legacy quote path:** Google Docs/Sheets/Slides, plain text/CSV, and supported Microsoft Office documents are read or temporarily converted. Text/table heuristics reconstruct booking facts and menu lines.
3. **Legacy booking-form path:** attached spreadsheets are parsed as a fallback.
4. **Title/event fallback:** event summary, description, location, owner and start/end supply missing fields.
5. **Delivery-event path:** Calendar events recognised as delivery schedule/reminder/collection records are stored separately in `CPU Deliveries`; they are not linked to a booking or CPU order by a canonical identifier.

No Gmail API or inbox scan exists in this CPU project. Gmail is upstream in hospitality adapters, not a direct CPU dependency. CPU may receive Gmail-derived facts through an attached legacy form/quote or booking object.

## Dependencies and current sources

| Dependency | Current use | Architectural classification |
|---|---|---|
| Google Calendar advanced service | Discovers events/attachments, supplies event envelope, cancellation signal, creator/organiser and update timestamp | Current ingestion adapter and operational projection source; not the future booking authority |
| Google Drive | Reads booking/quote/form attachments, inspects file modification time, temporarily converts Office files, stores prep/allergen photographs | Integration and evidence storage |
| Google Sheets | Stores settings, CPU order projection, delivery projection and scan log | Operational projection/audit, not canonical booking source |
| Docs, Sheets and Slides services | Extracts text or tables from Google and converted Office documents | Legacy parser adapters |
| Apps Script Properties/Cache/Locks | Scan-job state, data-version cache invalidation, configuration cache and write locking | Runtime infrastructure |
| Gmail | No direct dependency found | Upstream legacy adapter only |
| External HTTP API | No production order-ingestion API call found | TODO future canonical delivery mechanism |

The scanner account must be able to read attached Drive files. Failed permissions or unsupported formats generate warnings rather than a complete canonical order.

## Current CPU order projection

The row key is the configured Calendar ID combined with the Calendar event ID. The stored projection contains:

- Calendar identity/link and source update/scanned timestamps;
- site identity, label/code/colour and event-owner email;
- event start/end/date, delivery time and service time;
- client/company, service type, pax, location, floor/room and host;
- operational notes and a flattened dietary string;
- menu lines as JSON with `name`, numeric `quantity` and `notes`;
- quote and booking source link/name metadata and attachment count;
- CPU status, warnings, raw event JSON and detected changes;
- prep flag, actor/time and prep/allergen photo metadata.

This row is a lossy operational projection. It does not preserve the full booking/customer/pricing/status/concurrency contract and should not become the commercial source of truth.

### Production statuses and workflow state

Confirmed CPU order status values are `READY`, `NEEDS_ATTENTION` and `CANCELLED`. `READY` means required parser signals were found; it is not commercial confirmation. `NEEDS_ATTENTION` is set when warnings exist, including unreadable pax or absent menu lines. `CANCELLED` is defined and can be applied through the dashboard, but cancelled Calendar events are skipped before parsing; the scanner does not demonstrably update an existing row to cancelled when the event disappears or is returned cancelled. This is a cancellation propagation risk.

`Prepped`, `PreppedAt`, `PreppedBy`, change flags, warnings and photo evidence are dashboard/production workflow state, separate from `FikaBooking.status`.

## Production-line behaviour

### Aggregation and quantities

The browser normalises an item name into a grouping key, assigns a keyword-based production category, and sums numeric quantities across visible orders. It also calculates site splits and preserves a drill-down to booking/order, client, time, quantity and prep state. Aggregation is name-based rather than stable catalogue-item-ID-based.

Parser quantity rules accept several legacy textual arrangements. One special case changes a platter count into the stated number of people and retains platter context in notes. Duplicate parsed items are removed by lower-cased name plus numeric quantity. This can collapse genuinely repeated equal lines or fail to combine semantically equal names with textual differences.

The current production line shape is effectively `name`, `quantity`, `notes`, derived category and originating order/site data. No unambiguous production unit, yield, conversion rule, batch size or stable product ID is carried. TODO: confirm whether CPU prepares ordered units, portions, platters, batches or ingredients for each product family.

### Date, time, site and location

- Event date comes from Calendar start in the script timezone.
- Delivery time prefers parsed booking content and otherwise uses Calendar start.
- Service time is parsed separately when present.
- All-day Calendar dates are converted through JavaScript `Date`; timezone/boundary behaviour needs fixture coverage.
- Site is currently resolved from the event owner/organiser and configured site directory, with text/calendar fallbacks. At read time the owner mapping can override the stored site columns.
- Location and floor are flattened strings even where the draft booking has structured `FikaServiceLocation`.

CPU genuinely requires a stable producing/requesting site, destination/service location label and instructions, service date/window, and the required-at/delivery time used for kitchen sequencing. Whether “delivery time” is dispatch, arrival, handover or CPU-ready time is unresolved.

### Dietary, allergens and notes

The preferred legacy JSON adapter converts a fixed set of dietary counters and allergy/free text into one display string. Text parsers use keyword and layout heuristics to separate dietary content, product lines, comments and boilerplate. The dashboard groups dietary orders by site and displays the whole string beside all order lines; it does not model dietary requirements per production line.

The draft booking supports structured booking-level dietary requirements and item comments, which is better than the current projection. CPU still needs a defined transformation from booking-level requirements to affected production lines, including whether counts are informational or alter required quantities. Allergen/prep photographs are production evidence and do not belong in the canonical booking.

Operational notes are currently mutable in the CPU projection. Customer/service instructions belong in `FikaBooking`; kitchen-only preparation notes and resolution decisions belong in the production order or dashboard workflow state. Ownership of edits made in CPU is unresolved.

## Amendments, cancellation, identity and audit

- Upsert identity is Calendar-plus-event ID, not `bookingId` or canonical version.
- Incremental scans compare event update time plus the preferred JSON file's last-modified time. Quote/form-only file changes are not included in this source version unless the Calendar event itself changes.
- Rescans preserve prep/photo workflow state and compare date, times, pax, type, location, floor, dietary, notes and a sorted name/quantity item summary. The generated change list is replaced by the latest detected comparison rather than maintained as a complete immutable history.
- Direct dashboard edits update Sheet cells without optimistic concurrency or write-back to the authoritative booking. They can be overwritten on a later reparse while some workflow fields are deliberately preserved.
- The scan log records each completed scan's actor, date range, calendar/order counts and warnings. Chunked scan jobs store temporary counters/errors in Script Properties.
- Parser warnings and raw event/attachment metadata are stored with each row. These are integration/audit metadata, not booking-domain fields.
- No canonical `bookingId`, booking `version`, idempotency key or stable legacy source reference is used for CPU duplicate prevention.

Partial-processing risks include per-event exceptions allowing the scan to continue with warnings, Calendar pages being saved in separate batches, non-transactional Sheet writes, transient scan jobs expiring, temporary conversion failures, and different Orders/Deliveries/Scan Log state after interruption. Order upserts are protected by a script lock; delivery upserts are not protected by the same lock.

## Fields reconstructed from layout or integration context

Legacy adapters reconstruct or infer client/company, host, pax, service type, delivery/service times, location/floor, notes, dietary text and item name/quantity/notes from document labels, rows, text patterns, title format and Calendar metadata. Site is inferred from owner/text configuration. Production categories are inferred from item-name keywords. These reconstructions are parser metadata or adapter decisions and must not define canonical semantics.

## Repeated functions and FIKA Core candidates

Strong shared candidates, once contracts are approved, are:

- canonical record identity/version/idempotency and source-reference handling;
- ISO date/time and timezone normalisation;
- structured service-location projection;
- booking-to-production transformation orchestration;
- stable catalogue-item/product resolution and deterministic line aggregation;
- structured dietary/allergen projection;
- Sheets header mapping, batch upsert and versioned projection adapters;
- Drive file-ID extraction, safe temporary conversion/cleanup and permission-error classification;
- Calendar pagination and incremental-source adapter primitives;
- structured warning/audit/change records and retry-safe logging.

Legacy quote/form text extraction, current title patterns, site-owner mapping and Office-layout heuristics should remain ingestion-adapter-specific. CPU category rules, production conversion/yield rules, kitchen workflow, prep evidence and delivery scheduling should remain production-domain or app-specific until explicitly modelled.

## Performance and reliability observations

- Source-map loading reads key and timestamp columns for the complete Orders sheet on every scan/chunk; every chunk rebuilds it.
- Existing Orders rows are fully read on each upsert batch. Existing rows are then updated one at a time; additions are batched.
- Delivery rows are fully read and updated one at a time.
- Order detail and photo upload read all orders across the full date range before finding one record.
- Dashboard range reads are cached and versioned, but any order/delivery mutation invalidates all range variants.
- Calendar scans may call Drive metadata for a JSON attachment on each candidate event; deep scans also parse/convert attachments.
- Office parsing creates temporary Drive conversions and may combine multiple extraction methods.
- The browser performs production aggregation, category matching and site splits on every render/filter change.
- `Script.html`, parser and styles are overloaded, increasing change and test risk.

Actual latency, quotas, record counts and business impact are TODO measurements; these code patterns are not proof of a production incident.

## Provisional domain boundary

| Boundary | Owns | Must not own |
|---|---|---|
| `FikaBooking` | Commercial identity/version/status/source; customer; requesting site; structured service date/time/location; guest/service facts; customer instructions; structured dietary requirements; frozen price snapshot | CPU readiness, prep state, parser warnings, Calendar envelope or production conversion |
| `FikaBookingItem` | Stable ordered item identity/catalogue reference, ordered name/details snapshot, ordered quantity and unit/serving snapshot, choices/comments, requested item service time and frozen line price | Aggregated kitchen batch, keyword category or prep completion |
| `FikaProductionOrder` | Stable production-order ID; source booking ID/version; production status; required-at/dispatch/arrival semantics; producing site/facility; destination projection; production notes; cancellation/amendment disposition; generated/version audit | Authoritative commercial booking status or price |
| `FikaProductionLine` | Stable line ID; source booking-item references; resolved product identity/name snapshot; production quantity and unit; conversion/yield snapshot; category/work centre; dietary/allergen instructions; site/order allocation | Customer pricing or parser-specific row positions |
| Dashboard workflow state | Ready/needs-attention, prepped/completed flags, chef attribution, UI filters, photo evidence and acknowledgement of changes | Commercial status |
| Integration/audit metadata | Calendar/file/source references, adapter name/version, scan timestamp/job, parsing warnings, raw-source retention pointer, idempotency and immutable processing/change events | Business facts inferred solely for UI convenience |

## CPU requirement classification against draft FikaBooking v1

| CPU requirement | Classification | Evidence and action |
|---|---|---|
| Stable booking identity and record version | Already represented correctly | `bookingId`, `schemaVersion`, `version`, audit timestamps/actors exist; CPU does not yet consume them |
| Source channel and stable source reference | Already represented correctly | Draft `source` can replace Calendar-only identity while retaining adapter metadata |
| Commercial status/cancellation | Already represented correctly | Draft status is separate; CPU requires an explicit transformation/cancellation event, not reuse of CPU status |
| Requesting site | Already represented correctly | Draft `siteId`; CPU should stop overriding it from event-owner mapping after trusted canonical ingestion |
| Customer/company/host | Represented but needs refinement | CPU needs a display contact/company; define which customer/contact role is operationally safe and necessary |
| Service date/time/timezone | Represented but needs refinement | Draft start/end and item service time exist; define dispatch, required-ready, arrival and service meanings |
| Structured destination/location | Already represented correctly | Draft service-location object plus display label supports a safer projection than current strings |
| Pax/service type | Already represented correctly | Guest count and service type are present |
| Ordered item identity/name/quantity | Represented but needs refinement | Stable item/catalogue IDs exist; clarify ordered unit/serves snapshot and production conversion input |
| Production quantity, unit, yield and batch | Belongs in `FikaProductionOrder` rather than `FikaBooking` | Specifically belongs on `FikaProductionLine`, derived with a versioned rule snapshot |
| Production category/work centre | Belongs in `FikaProductionOrder` rather than `FikaBooking` | Production-line routing concern, not commercial order data |
| Frozen pricing | Already represented correctly | Required for commercial audit but CPU does not need pricing to plan production |
| Structured dietary/allergen requirements | Represented but needs refinement | Draft is structured; mapping to affected items/production lines and count semantics need decisions |
| Customer/service instructions | Already represented correctly | Booking/service/item comments can project downstream |
| Kitchen-only notes and resolution | Belongs in `FikaProductionOrder` rather than `FikaBooking` | CPU-owned operational information |
| CPU ready/attention/prepped/photo state | Operational projection only | Dashboard/production workflow, not authoritative booking status |
| Calendar IDs, attachment links, parser warning/raw layout | Legacy/parser metadata only | Retain under integration/audit metadata; never canonical business fields |
| Amendment acceptance and cancellation disposition | Unresolved business decision | Define event delivery, version ordering, late amendment/cutoff and already-prepped handling |
| CPU order creation trigger/status eligibility | Unresolved business decision | Confirm which booking statuses produce, update, hold or remove production work |

## Failure and early-consolidation risks

- Treating `READY` as “commercially confirmed” would conflate parser completeness with booking status.
- Directly making CPU Sheets authoritative would lose booking version, price/customer structure and safe amendment semantics.
- Replacing legacy adapters before canonical delivery is proven would interrupt current Calendar/document workflows.
- Aggregating by display name can merge different products or split the same product; stable production identities and explicit conversions are prerequisites.
- Automatically converting dietary counts into quantities without approved rules is unsafe.
- A single booking can be amended while already prepped; neither overwrite nor ignore is safe without a business disposition workflow.
- Removing Calendar too early would also remove current discovery, timing, delivery-event and audit behaviour. Migration should first run canonical ingestion alongside the adapter and compare projections.

## FikaBooking v1 Compatibility Review

### What the draft already supports

The draft provides a sound commercial foundation: stable booking and item IDs, schema/record versioning, audit actors/timestamps, source channel/reference, separate commercial status, site, structured service timing/location, customer and guest/service facts, item snapshots, structured dietary requirements, acknowledgements, frozen pricing and generic charges. These cover most facts CPU should receive rather than reconstruct.

### What requires clarification

- the meaning and ownership of dispatch, CPU-ready, delivery/arrival and service times;
- ordered quantity unit and how `servingInfoSnapshot` drives production conversion;
- production eligibility by booking status;
- amendment ordering, cutoffs, acknowledgements and already-prepped handling;
- cancellation propagation and disposition;
- mapping booking-level dietary counts/notes to items and production lines;
- whether one booking can create more than one production order or producing facility;
- ownership and write-back rules for corrections entered by CPU staff.

### What should be removed or avoided

No confirmed draft booking field must be removed on this evidence. Avoid adding Calendar IDs, Drive links, parser row positions, CPU status, warnings, prep flags, chef identity, photographs, keyword categories, flattened dietary display strings or raw attachment content as first-class booking fields. Avoid requiring pricing fields in the CPU projection merely because they remain mandatory in the authoritative booking snapshot.

### What belongs in the future production-order schema

Production-order identity/version/status, source booking ID/version, generating rule/version, producing facility, required/dispatch/arrival timing, destination projection, production notes, amendment/cancellation disposition, and lines containing stable product resolution, source booking-item references, production quantity/unit, yield/conversion snapshot, production category/work centre, dietary/allergen instructions and allocation back to booking/site belong downstream. Workflow evidence and integration attempts should be separately modelled or referenced.

### Is FikaBooking v1 still a sound basis?

Yes. The draft remains a sound basis for authoritative hospitality bookings. CPU evidence calls for targeted clarification of service-time semantics, ordered units and dietary-to-line mapping, plus a separate `FikaProductionOrder`/`FikaProductionLine` model. It does not justify embedding CPU workflow state into `FikaBooking`.

## Manual questions for Derek

1. Which commercial statuses should create, hold, update, cancel or complete CPU production work?
2. What does CPU “delivery time” mean today: ready for dispatch, departure, venue arrival or handover? Who owns it?
3. Can one booking be produced by multiple facilities or generate multiple production orders?
4. What production units are required (portions, platters, trays, batches, items, kilograms or others), and where are yield/conversion rules owned?
5. Does a platter “for N people” mean CPU produces N portions, one platter, or both measures?
6. How should booking-level dietary counts be allocated to particular menu lines, and which changes require human confirmation?
7. What should happen when a confirmed booking is amended or cancelled after preparation has started?
8. Should CPU edits correct the booking through a governed amendment, remain CPU-only notes, or both depending on field?
9. Are separately scheduled delivery Calendar events expected to link to booking/production-order IDs?
10. What are the application's lifecycle, users, owner, production volumes, criticality and acceptable scan delay?

## Readiness for a production-order draft

There is enough structural evidence to draft `FikaProductionOrder` v1 and `FikaProductionLine` v1 as explicitly provisional schemas. Status eligibility, time semantics, units/conversions, amendment/cancellation handling and dietary allocation must remain TODO or constrained extension points until Derek confirms them.
