# Hospitality Booking Platform Family Report

## Scope and Authority

This report is a read-only inspection of the Hospitality Booking Platform family in `C:\FIKA`, using MNK as the preferred consolidation baseline.

Confirmed architectural authority:

```text
Booking Platform
        ↓
Canonical Booking Object
        ↓
Hospitality Dashboard
        ↓
CPU Dashboard
        ↓
Logistics
```

The Booking Platform is the authoritative source of hospitality bookings. Dashboards should consume booking objects rather than reconstruct bookings from spreadsheets or email wherever possible. Booking-form spreadsheets and inbox parsing are legacy inputs and should not be recreated for future sites without a specific operational requirement.

No production code, Apps Script configuration, Git state, or deployment was changed. Script IDs, deployment IDs, production URLs, secrets, and private customer data are omitted.

## Executive Summary

Four direct booking-platform implementations exist: MNK, Angel Court, CFC, and Demo. No separate The Line booking platform exists locally.

All four already share a strong product contract:

- the same browser payload field names;
- the same server-built booking-object shape;
- server-authoritative menu validation and price recalculation;
- direct writes to a Hospitality Dashboard `Dashboard Data` projection;
- structured line-item storage;
- a common notification workflow; and
- nearly identical Apps Script/HTML architecture.

MNK and CFC share the entire `02_BookingService.js` byte-for-byte. All four share the web entry point, test harness, and Apps Script manifest exactly. Differences are concentrated in configuration, menus, presentation, dashboard connection arrangements, Angel Court validation, and Demo feedback.

The shared product boundary is therefore clearer than in the dashboard family: one booking-platform codebase can own submission, canonicalisation, validation, pricing, acknowledgements, and canonical event/item/customer construction. Independent site deployments should provide configuration, menu/catalogue data, branding, recipients, feature flags, and narrowly defined rule extensions.

## Current Product Boundary

### Shared Product Responsibilities

- Render and collect a hospitality booking request.
- Build a typed booking payload from browser state.
- Rebuild the booking on the server and discard untrusted client pricing.
- Validate customer, event, item, dietary, acknowledgement, and lead-time rules.
- Generate a stable booking reference.
- Persist the authoritative canonical booking object.
- Publish a dashboard-compatible projection without making the projection authoritative.
- Persist structured booking items where an operational Sheet view is still useful.
- Notify operational recipients after successful persistence.
- Return a booking reference and submission result to the public client.

### Site/Tenant Responsibilities

- Site identity and booking-reference prefix
- Branding and public copy
- Menu/brochure catalogue and item availability
- Event types and allowed menu categories
- Minimum quantities, minimum guests, and item notice periods
- Standard, large-event, and dietary notice rules
- Pricing, tax, management/service/delivery fee policy
- Notification recipients
- Destination/application references
- Optional features such as Demo feedback

### Legacy Adapter Responsibility

Angel Court must retain the Gmail/XLSX inbox scanner as a fallback. That path should be treated as an input adapter:

```text
Legacy email + booking form
        ↓
Angel Court legacy parser adapter
        ↓
Canonical Booking Object
        ↓
The same dashboard ingestion contract used by direct submissions
```

The parser may retain source metadata for traceability, but it should not define a second booking domain model.

## Variant Findings

### MNK — Preferred Baseline

1. **Folder:** `C:\FIKA\sites\mnk\booking-platform`
2. **Lifecycle and purpose:** Confirmed Live. Preferred reference for future consolidation. Client-facing direct hospitality booking platform.
3. **Technology and structure:** Google Apps Script JavaScript; HTML service (`Index.html`, `Script.html`, `Styles.html`); site config, menu data, booking service, Sheet adapter, web entry point, tests, and email service.
4. **Apps Script linkage:** `.clasp.json` present; coordinated root deployment automation exists.
5. **Menu source:** Menu and wording transcribed from the confirmed MNK hospitality brochure into `01_MenuData.js`.
6. **Submission destination:** Builds booking-object JSON directly, writes a dashboard projection to the MNK dashboard spreadsheet, and writes structured line items/settings to the booking platform's operational spreadsheet. It does not depend on a booking-form spreadsheet.
7. **Payload:** Common client/event/order/dietary/acknowledgement/special-instruction input becomes the common server booking object detailed below.
8. **Booking ID:** Site prefix + local timestamp + short random suffix, generated server-side while holding a script lock; dashboard uniqueness is checked before append.
9. **Customer/contact:** Name, email, phone, company name, optional invoice/internal reference.
10. **Delivery/service:** Date, start/end, guest count, floor, room/area, delivery point, onsite contact name/phone; per-item required time; selected event type.
11. **Items:** Category, stable item ID, name, description, serving info, price type, unit price, quantity, total, time, choices, comments, minimums, notice days, and rule-result booleans.
12. **Pricing:** Server looks up each item in the menu schema and recalculates unit and line totals; browser prices are not trusted. Order net total is the sum of line totals.
13. **VAT:** Dashboard adapter applies 20% VAT after fees. Menu/order values are net/ex-VAT; display copy states that prices exclude VAT.
14. **Other fees:** Booking-platform management fee is configured as zero. No delivery/service charge is added in this booking service. A separate MNK dashboard delivery-charge rule exists downstream and is therefore not yet part of the authoritative submission calculation.
15. **Dietary/allergen:** Structured counts for vegetarian, vegan, gluten-free, coeliac, dairy-free, halal and other; allergy detail, severe-allergy acknowledgement, and free text.
16. **Lead time:** 72-hour standard notice, seven working days for large-event types, three working days for dietary notice, plus item-level notice days.
17. **Validation:** Required customer/contact fields; ISO-like date/time formats; time ordering; positive guest count; location; event type; allowed categories; non-empty items unless event type allows empty; item minimum quantity/guest rules; required choices; all acknowledgements; severe-allergy acknowledgement.
18. **Confirmation:** Writes first, then sends an operational notification. The browser shows the returned booking reference. This is request acknowledgement, not evidence of a customer booking-confirmation workflow.
19. **Site configuration:** Site identity, prefix, timezone/currency, dashboard and booking spreadsheet references, tab names, rules, copy, branding, recipients, event types, rates, and log flag.
20. **Hardcoded values:** Menu content/prices, event-type/category mapping, lead-time defaults, tax/fee rates, tab names, public copy and branding defaults. Production identifiers exist in local configuration but are excluded here.
21. **Shared code:** Booking service exact with CFC; web entry, tests and manifest exact across all four; client almost exact with CFC/Demo.
22. **Performance risks:** Script lock serialises submissions; uniqueness check scans the dashboard booking-ID column; settings/menu config is assembled for page render; multi-Sheet write/rollback is not transactional. Impact is unmeasured.
23. **Large files:** `Styles.html` about 2,086 lines; `Script.html` 791; `03_SheetsService.js` 494; `02_BookingService.js` 247.
24. **Client/server boundary:** Browser sends IDs, quantities, choices and form fields in one `google.script.run` submission. Server owns lookup, validation, warnings, booking ID, and pricing. This is an appropriate baseline boundary.
25. **FIKA Core candidates:** Booking builder, validation framework, menu lookup/repricing, money/date cleaning, working-day calculation, booking-ID strategy, dashboard projection interface, header mapping, duplicate-ID check, structured notification rendering.
26. **Remain site-specific:** Menu catalogue, event types, allowed categories, notice/fee policy, branding/copy, recipients, spreadsheet/deployment references, and any confirmed MNK downstream fee/recharge rules.

### Angel Court

1. **Folder:** `C:\FIKA\sites\angel-court\booking-platform`
2. **Lifecycle and purpose:** Confirmed Live. Direct booking platform is the preferred path; Gmail/XLSX remains a legacy fallback through the separate dashboard scanner.
3. **Technology and structure:** Same Apps Script/HTML architecture as MNK; larger menu, client and style files.
4. **Apps Script linkage:** `.clasp.json` present; root deployment automation exists.
5. **Menu source:** Menu/prices were transcribed from an existing Angel Court booking-form workbook. This is historical catalogue input, not a reason to recreate spreadsheet booking forms.
6. **Submission destination:** Direct dashboard write; operational line-item/settings Sheets. The current README says the canonical booking JSON is later attached to Calendar and preferred by CPU over legacy parsing.
7. **Payload:** Same common server booking object as MNK.
8. **Booking ID:** Same server algorithm with Angel Court prefix.
9. **Customer/contact:** Same fields, including optional invoice/internal reference.
10. **Delivery/service:** Same common event fields and per-item service times.
11. **Items:** Same common item structure; Angel Court has different catalogue categories, choices, unavailable-item support and wine helper.
12. **Pricing:** Same server-authoritative recalculation.
13. **VAT:** 20% after fees.
14. **Other fees:** 8% management fee in the booking-platform adapter. No direct delivery/service fee found.
15. **Dietary/allergen:** Same structured contract.
16. **Lead time:** 72-hour standard notice, ten working days for large-event types, three working days for dietary notice, plus item notice days.
17. **Validation:** Common validation plus required end time for bespoke events and support for an empty category list on bespoke event types.
18. **Confirmation:** Direct write followed by operational notification; browser acknowledgement. Legacy email submissions follow the dashboard scanner path and do not yet share this builder directly.
19. **Site configuration:** Same categories as MNK with Angel Court values, broader event types, and different fee/notice policy.
20. **Hardcoded values:** Catalogue, event/category map, fee/notice defaults, branding/copy, recipients and operational tab defaults; production identifiers omitted.
21. **Shared code:** Booking service differs from MNK by two small validation changes. Web entry, tests and manifest exact; most server/client code near-identical.
22. **Performance risks:** Same shared submission risks; legacy Gmail/form fallback has the separate scanner/parser risks documented in the dashboard-family report.
23. **Large files:** `Styles.html` about 2,184 lines; `Script.html` 848; `03_SheetsService.js` 414; menu 123 lines.
24. **Client/server boundary:** Same strong direct boundary as MNK; legacy path currently derives domain data from an XLSX parser.
25. **FIKA Core candidates:** Common MNK candidates plus an explicit source-adapter interface for legacy email bookings.
26. **Remain site-specific:** Legacy form parser, inbox query/label policy, Angel Court catalogue, bespoke validation, 8% management fee, ten-day large-event rule, branding and recipients.

### CFC

1. **Folder:** `C:\FIKA\sites\cfc\booking-platform`
2. **Lifecycle and purpose:** Confirmed built but not Live; recorded as Development until a different permitted lifecycle is confirmed.
3. **Technology and structure:** Same Apps Script/HTML architecture.
4. **Apps Script linkage:** `.clasp.json` present; no dedicated root deployment automation found.
5. **Menu source:** CFC hospitality brochure content transcribed into `01_MenuData.js`.
6. **Submission destination:** Direct dashboard write plus operational line-item/settings Sheets.
7–11. **Payload, ID, customer, event and item structure:** Same as MNK; booking service is byte-for-byte identical.
12. **Pricing:** Same server-authoritative calculation.
13. **VAT:** 20% after fees.
14. **Other fees:** Management fee configured as zero; no delivery/service fee found in the booking platform.
15. **Dietary/allergen:** Same common structure.
16. **Lead time:** 72 hours standard, seven working days large events, three working days dietary, plus item notice days.
17. **Validation:** Same as MNK.
18. **Confirmation:** Same write-then-operational-notification flow.
19–20. **Configuration/hardcoding:** CFC identity, brochure catalogue, event/category mapping, rules, branding, recipients, tabs, and destination settings.
21. **Shared code:** Closest implementation to MNK: exact booking service, web entry, tests and manifest; menu differs by only a few lines; client differs by one line.
22. **Performance risks:** Same shared submission patterns; production impact cannot be assessed because it is not live.
23. **Large files:** `Styles.html` about 2,034 lines; `Script.html` 791; `03_SheetsService.js` 411.
24. **Client/server boundary:** Same as MNK.
25. **FIKA Core candidates:** Same as MNK.
26. **Remain site-specific:** Catalogue, event/category map, branding/copy, recipients, rules and destination configuration.

### Demo

1. **Folder:** `C:\FIKA\sites\demo\booking-platform`
2. **Lifecycle and purpose:** Development/demo capability for sales and tender demonstrations, not a source of production business truth.
3. **Technology and structure:** Same Apps Script/HTML architecture plus `07_FeedbackService.js`.
4. **Apps Script linkage:** `.clasp.json` present; root demo deployment automation exists.
5. **Menu source:** FIKA-branded demonstration menu; authoritative business source is not documented.
6. **Submission destination:** Direct dashboard write plus operational line-item/settings Sheets; Demo also initiates a feedback request.
7–17. **Contract/rules:** Common booking object; common ID/customer/event/item/dietary/validation structure; 20% VAT, zero management fee, 72-hour standard, seven-day large-event and three-day dietary rules.
18. **Confirmation:** Operational notification plus demo feedback request; browser acknowledgement.
19–20. **Configuration/hardcoding:** Demo branding, recipient, feedback settings, catalogue and example defaults.
21. **Shared code:** Exact web entry, tests and manifest; client differs from MNK by two lines; booking service adds only demo feedback invocation.
22. **Performance risks:** Same shared patterns plus extra email/feedback work after submission.
23. **Large files:** `Styles.html` about 2,320 lines; `Script.html` 791; `03_SheetsService.js` 524; email service 228.
24. **Client/server boundary:** Same base boundary with demo-only post-submit extension.
25. **FIKA Core candidates:** Only shared code verified against live MNK/Angel Court behaviour.
26. **Remain site-specific:** Demonstration branding, sample catalogue, recipient, feedback preview and demo-only compatibility code.

### The Line

- No local direct booking-platform folder or implementation was found.
- The existing The Line Hospitality Dashboard uses the legacy Gmail/XLSX path with a distinct parser and revision-matching workflow.
- It is not the baseline for standard hospitality consolidation.
- The Events Dashboard takes priority over further The Line platform development.
- If a direct The Line public experience is built later, it should publish the canonical booking/event contract rather than reproduce the legacy form workflow.

## Shared Code Comparison

### Exact Duplicates

- `04_Webapp.js`: all four platforms
- `05_TestHarness.js`: all four
- `appsscript.json`: all four
- `02_BookingService.js`: MNK and CFC
- `.claspignore`: MNK, CFC and Demo

### Near Duplicates

- MNK and CFC `Script.html` differ by one line; their menus differ by only a few lines.
- Angel Court booking service adds only bespoke-event validation differences to the common service.
- Demo booking service adds only demo feedback invocation to the common service.
- All Sheet services share the same adapter, append, headers, settings, connection, duplicate-ID and notes structure. MNK/Demo additionally support separate booking and dashboard spreadsheets and header initialisation; Angel Court/CFC use a simpler connection path.
- Email services differ mainly in site copy; Demo adds richer line-item content.
- Styles and index files share structure but contain branding/layout divergence.

### Configuration-Only Differences

- Site ID/name/address, reference prefix, timezone/currency
- Branding, logos, colours, public copy and labels
- Spreadsheet/tab references and request-log flag
- Notification recipients and dashboard link
- Menu catalogue and display order
- Event types and permitted categories
- Notice thresholds, VAT and management-fee rates
- Demo feedback feature

### Genuine Business-Rule Differences

- Angel Court 8% management fee versus zero in MNK/CFC/Demo.
- Angel Court ten-working-day large-event warning versus seven in the others.
- Angel Court requires an end time for bespoke events and permits its empty-category bespoke event type.
- Catalogue item minimums, choices, availability and notice periods vary by site.
- MNK delivery charge is currently applied downstream in its dashboard rather than in the authoritative booking-platform calculation; ownership must be resolved.
- Demo feedback is demonstration-specific.
- Angel Court legacy email/XLSX ingestion must remain available but should converge on the canonical object.

## Current Booking Data Contract

### Browser Submission Payload

- `client`: name, email, phone, company name, invoice reference
- `event`: date, start/end times, guest count, floor, room/area, delivery point, onsite contact name/phone
- `order`: event type and requested items
- requested item: item ID, quantity, choice IDs/values, comments, required time
- `dietaries`: declaration flag, category counts, allergy detail, severe-allergy acknowledgement, free text
- `acknowledgements`: quote confirmation, notice policy, dietary responsibility
- `specialInstructions`

### Server Booking Object

The server adds and owns:

- booking ID, submitted timestamp, initial status, source, site name and site ID;
- cleaned customer/event fields;
- catalogue-resolved item descriptions, serving data, prices, minimums and notice rules;
- recalculated line totals and order net total;
- structured warning flags/lists;
- cleaned acknowledgements and instructions; and
- internal downstream-processing booleans.

### Dashboard Projection

The adapter adds or reshapes:

- dashboard status and validation errors;
- `sourceType = CLIENT_PLATFORM`;
- synthetic email/attachment fields for compatibility;
- service type and unique service times;
- dashboard item fields (`section`, `name`, `detail`, `info`, `qty`, `time`, `comment`, price and item ID);
- subtotal, management fee, net, VAT and gross values;
- flattened notes and dietary/warning summaries;
- blank quote/Calendar/audit fields; and
- the complete booking object nested as `clientBooking` inside `ParsedJSON`.

This projection is currently required by dashboard code, but it is not the long-term authoritative booking record.

## Different Payload Shapes

1. **Direct platform booking object:** structured `client`, `event`, `order.items`, `dietaries`, warnings and acknowledgements. This is the preferred canonical starting point.
2. **Dashboard projection:** flattened spreadsheet-compatible fields plus dashboard-shaped items and nested `clientBooking`.
3. **Legacy email-derived dashboard object:** parser-produced booking fields with Gmail message/thread/attachment metadata and no guaranteed `clientBooking` source object.

The current code therefore has one common direct payload across all four platforms, but two ingestion-era shapes at the dashboard boundary.

## Fields Used by Dashboards but Not Explicitly Defined in the Direct Object

- Dashboard lifecycle/status vocabulary such as `READY`, `NEEDS_REVIEW`, quote, confirmation, cancellation, archive and recharge states
- Validation error list
- Service-time list and display service-type label
- Management fee, VAT and gross price breakdown
- Quote URL/timestamps/printed state/staleness
- Calendar ID/URL/timestamps/staleness/removal
- Manual edit and actor timestamps
- Confirmation/cancellation metadata
- Error and audit fields
- Gmail message/thread/attachment/source subject fields for legacy inputs
- The Line fingerprint/revision metadata
- MNK recharge state and downstream delivery-charge adjustments

These require ownership decisions: canonical booking, downstream workflow state, integration metadata, or audit event.

## Provisional Canonical Booking Contract

This is a field inventory, not a final JSON schema.

### Confirmed Fields

**Identity and provenance**

- `bookingId`
- `submittedAt`
- `status` (vocabulary unresolved)
- `source` / source channel
- `siteId`
- site display reference

**Customer/contact**

- customer/contact name
- email
- phone
- company/organisation name
- invoice, purchase-order, cost-centre or internal reference

**Service/event**

- event/service date
- start time
- end time
- guest count
- floor
- room/area
- delivery point
- onsite contact name and phone
- event/service type

**Order and pricing**

- structured booking items
- net item subtotal
- currency is confirmed in site configuration and submission results; whether it is embedded in the canonical object is unresolved

**Dietary/allergen**

- declaration flag
- structured dietary counts
- allergy details
- severe-allergy acknowledgement
- dietary free text

**Request context**

- special instructions
- acknowledgement records
- warnings/validation outcomes

### FikaBookingItem Fields

- stable item/catalogue ID
- category/section ID or label
- item name snapshot
- description/serving-information snapshot
- quantity
- unit price
- line total
- price type
- currency or inherited booking currency
- requested service time
- selected choices/options
- comments/instructions
- minimum quantity and minimum guest snapshot
- notice-required-days snapshot
- validation results for minimums/notice

### FikaCustomer Fields

- stable customer ID: TODO; no stable customer identity exists in current payload
- contact name
- email
- phone
- organisation/company name
- invoice/internal reference should likely remain booking-specific rather than customer master data

### Optional Fields

- end time where not required
- invoice/internal reference
- floor, room/area or delivery point, subject to at least one location value
- onsite contact fields
- per-item service time
- item choices and comments
- special instructions
- dietary counts/details when none are declared
- downstream quote/Calendar references if the canonical record owns workflow links
- legacy source metadata for traceability

### Variant-Only Fields or Rules

- Angel Court bespoke end-time requirement
- Angel Court management-fee rate and ten-day large-event rule
- MNK downstream delivery charge and recharge metadata
- The Line legacy message/attachment fingerprint, revision and replacement metadata
- Demo feedback result
- Site-specific catalogue categories, item choices and minimums

### Unresolved Fields

- Canonical status vocabulary and lifecycle owner
- Stable `customerId`
- Whether site display name is embedded or resolved from `siteId`
- Canonical location structure versus floor/room/delivery strings
- Tax, fee, discount, labour, equipment and delivery-charge line model
- Whether warnings are immutable submission facts or recalculated policy results
- Acknowledgement text/version/timestamp/actor requirements
- Quote and Calendar relationship fields versus separate canonical objects
- Cancellation, confirmation, archive and recharge metadata ownership
- Legacy source-file/message references and retention
- Booking version, idempotency key and optimistic-concurrency rules
- Created/updated metadata and record version required by platform principles
- Pricing, tax and catalogue policy references required to reproduce submitted totals

### Proposed Ownership

- Booking Platform: authoritative creation, customer/event request, selected items, price calculation at submission, dietary/allergen declarations, acknowledgements, source channel and initial validation.
- Hospitality Dashboard: operational projection, qualification/editing, quote/Calendar workflow state, confirmation/cancellation and site operations.
- CPU Dashboard: production projection and preparation state; must consume the booking object rather than re-parse quotes/forms when structured data exists.
- Logistics: delivery/logistics projection derived from canonical service and item requirements.
- Site/App configuration: menu assignment, pricing/rule versions, branding, recipients and integration references.

### Source of Truth

- The authoritative hospitality booking originates in the Booking Platform as a canonical booking object.
- The dashboard Sheet is a consumer and operational projection, not the primary booking truth.
- Email and booking-form spreadsheets are legacy source inputs only. Their parsed output must become the same canonical booking object.
- Booking-platform operational Sheets for line items/settings are views/admin surfaces unless separately designated; they do not replace the canonical object.
- Quote, Calendar, CPU and Logistics records are downstream outputs/projections linked by stable booking ID and version.

### Schema Questions for Derek

1. What statuses belong to the authoritative booking versus dashboard workflow state?
2. Should edits made in the dashboard update the authoritative booking object, create a new version, or remain an operational overlay?
3. Must prices be frozen as submitted snapshots, and how should later catalogue changes be represented?
4. Should fees/taxes be explicit priced lines or a separate totals breakdown?
5. Where should MNK delivery charges be calculated so the authoritative total is consistent?
6. Is an invoice/internal reference a booking field, customer field, or both?
7. What is the canonical location model for floor, room, area and delivery point?
8. Which acknowledgement text and policy version must be retained for audit?
9. What constitutes an idempotent duplicate submission across direct and legacy email channels?
10. Which legacy Gmail/XLSX identifiers must be retained, and for how long?

## Transforming Angel Court Legacy Email Bookings

The existing scanner/parser already derives many dashboard fields. A future adapter should:

1. Capture immutable source metadata separately: message/thread reference, attachment name/hash and received timestamp.
2. Parse the workbook into a source-neutral draft: customer, event/service, items, dietaries, notes and raw totals.
3. Resolve or map items to stable catalogue IDs where possible; preserve unmapped lines explicitly rather than silently inventing IDs.
4. Normalise dates, times, quantities, money and contact fields using the same shared validators as direct submissions.
5. Apply an explicit legacy pricing policy. Do not silently recalculate historic/form prices against a newer menu without a rule.
6. Produce the canonical booking contract with `sourceChannel = legacy_email_form` (name subject to schema decision).
7. Assign an idempotency key based on stable source metadata and booking identity.
8. Publish through the same dashboard ingestion interface used by direct platform bookings.
9. Preserve parsing warnings and unmapped fields as validation/audit results.
10. Add fixtures for every supported legacy form layout before replacing the existing path.

## Requirements for One Shared Codebase With Independent Deployments

- Versioned canonical booking and item contracts
- One server booking builder and validation pipeline
- One server-authoritative pricing pipeline
- Versioned menu/catalogue data per site
- Explicit tax/fee/delivery-charge policy interface
- Site/app configuration with safe/private separation
- Independent deployment configuration and rollback per tenant
- Stable dashboard ingestion contract that accepts canonical objects
- Legacy input adapter interface, initially for Angel Court and The Line where required
- Feature flags/extensions for Demo feedback and site-specific workflows
- Contract fixtures for MNK, Angel Court, CFC, Demo and supported legacy forms
- Idempotency and version checks across submission and downstream writes
- Structured logging without customer data leakage
- Measured performance and quota baselines
- Migration that keeps current live deployments operational until parity is proven

## Performance and Boundary Findings

### Confirmed Code Patterns

- One remote submission call sends the form payload; server recalculates and validates it.
- A script-wide lock serialises submissions for up to the configured wait period.
- Duplicate-ID checking reads the complete dashboard BookingID column.
- Dashboard row and structured line-item rows are written separately; rollback deletes rows if a later write fails.
- Notifications are sent after persistence and do not roll back a successful booking.
- Public config contains the menu and is rendered for the client.
- Client state and draft persistence are managed in a large `Script.html`; visual rules occupy very large `Styles.html` files.

### Suspected Risks

- Lock contention under concurrent submissions.
- Linear duplicate-ID checks as dashboard history grows.
- Partial state if Apps Script stops between writes or rollback fails.
- Large initial HTML/config payloads as catalogues grow.
- Drift between four copied codebases and between authoritative booking totals and downstream MNK fee calculation.

No production timings, concurrency volumes, payload sizes or failure rates were available.

## Functions Suitable for FIKA Core

Strong candidates after contract tests:

- `buildServerBooking_`
- `recalculateOrderItems_`
- `validateChoices_`
- `validateBookingRequest_` as a configurable validation framework
- warning/lead-time calculation framework
- `generateBookingId_` after ID rules are approved
- date, integer, money and string normalisation helpers
- Sheet header mapping and required-header validation
- duplicate-ID/idempotency checks after redesign
- canonical-to-dashboard projection interface
- notification recipient parsing and HTML escaping
- common public configuration assembly

Keep site-specific:

- menu/catalogue data and item wording
- event-type/category availability
- site notice thresholds and pricing/fee policy
- branding/public copy
- recipients and deployment references
- Angel Court legacy parser/query/label adapter
- Demo feedback
- any confirmed MNK delivery/recharge rule
- The Line legacy form/revision rules

## Manual Questions

- Resolve every question in the provisional contract section.
- Confirm whether Angel Court's 8% management fee and ten-day large-event rule remain current.
- Confirm whether MNK's downstream delivery charge must be present in the authoritative submitted price.
- Confirm the intended CFC lifecycle label beyond “built but not live”.
- Confirm the authoritative menu source and intended parity for Demo.
- Confirm whether booking-platform operational line-item/request-log Sheets remain necessary once canonical storage exists.
- Confirm expected concurrent submission volume and dashboard row growth.
- Confirm whether The Line needs any booking-platform work before the Events Dashboard priority is delivered; current direction indicates it does not.

## Readiness for FikaBooking Schema v1

There is enough evidence to begin a **draft** `FikaBooking` Schema v1 because the four direct platforms share one stable server object and MNK provides a live preferred baseline. There is not yet enough business confirmation to finalise or adopt Schema v1.

Drafting should wait only for answers on status ownership, versioning, fee/tax lines, MNK delivery charges, location structure, acknowledgement audit, idempotency, and dashboard edit ownership. No production migration should begin from the provisional field list alone.
