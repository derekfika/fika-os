# Shared Function Inventory

## CPU Production Dashboard candidates

| Area | Shared candidate | Remains adapter/app-specific |
|---|---|---|
| Ingestion | Calendar pagination, idempotent orchestration, canonical booking consumer | Event-title recognition, owner/site mapping and legacy layouts |
| Identity/version | Stable IDs, expected versions, idempotency and source references | Calendar/file metadata representation |
| Production transformation | Stable product resolution, deterministic aggregation, units and conversion snapshots | CPU categories, yields and kitchen rules |
| Dietary/allergen | Structured downstream projection | Legacy keyword parsing and business allocation rules |
| Sheets/Drive | Versioned batch projection adapters; safe conversion/cleanup/error helpers | Exact CPU row layout, attachment ranking and folder policy |
| Audit | Structured attempts, warnings, immutable changes and retry records | UI wording and temporary scan-job presentation |

CPU prep state, photographs, production notes, delivery scheduling and kitchen workflow are production-domain/app-specific, not `FikaBooking` core candidates.

## Status

Evidence-backed first pass for the Hospitality Dashboard family only. “Exact” means byte-for-byte file equality where stated. “Near” means the same named functions and structure with variant changes. No code has been centralised.

| Category | Function name | App ID | Purpose | Duplicate | Variations | FIKA Core candidate | Centralisation risk | Notes |
|---|---|---|---|---|---|---|---|---|
| Configuration | `getSettings_`, `getSettingSchema_`, `ensureSettingsDefaults_`, typed getters | All five Hospitality Dashboards | Build, read, validate, and expose runtime settings | Near | Site defaults, extra MNK booleans/recharge settings, The Line cache token | Yes | Medium | Establish precedence and ownership before extraction. |
| Configuration | `validateDashboardSettings_`, `isValidEmail_`, `isValidUrl_`, normalisation helpers | All five | Validate settings and values | Near | Field sets and permitted values vary | Yes | Low | Strong shared validation candidates with schema-driven rules. |
| Authentication | `verifyAdminPin`, `hashAdminPin_` | All five | Protect settings administration through a server-side PIN check | Near | Same pattern; deployment access unknown | Maybe | High | Requires security design first. A fixed hash default exists in source and is not reproduced here. |
| Booking | `createEmptyBooking_`, `validateBooking_` | All five | Define and validate the dashboard booking object | Near | Statuses and fields differ, including MNK recharge and The Line revision/source data | Yes | High | Canonical `FikaBooking` contract must precede centralisation. |
| Booking | `generateBookingId_` | All five | Generate booking identifiers | Exact in Angel Court/CFC/MNK/Demo; variant in The Line | The Line derives/normalises a site code differently | Yes | Medium | Stable ID rules and collision behaviour need specification. |
| Booking | Common date/time/money/parser helpers | All five | Normalise dates, times, quantities, floors, money, names, and notes | Exact parser file in CFC/MNK/Demo; near elsewhere | The Line adds range/date extraction and distinct form logic | Yes | Medium | Extract pure helpers; keep source-form mapping behind adapters. |
| Booking | Source-form classification and line-item parsing | All five | Convert site booking workbooks into booking objects/items | Near | Shared Angel Court-shaped parser in four variants; distinct The Line parser/classifier | No | High | Keep app-specific until canonical input adapters and fixtures exist. |
| Sheets | `getDashboardSheet_`, `getHeaderMap_`, required-header checks | All five | Resolve dashboard Sheet and map columns | Near | Header initialisation and extra fields differ | Yes | Medium | Needs versioned Sheet adapter and canonical field map. |
| Sheets | `writeBookingToSheet_`, row serialisation and lookup | All five | Persist booking rows and locate records | Near | Angel Court has stronger source-key/ID resolution; The Line has revision fields; MNK has extra columns | Maybe | High | Preserve stable-ID resolution and concurrency behaviour. |
| Sheets | Settings-sheet read/write helpers | All five | Read full settings table and write admin changes/defaults | Near | The Line shows cache-related divergence | Yes | Medium | Performance and cache invalidation contract required. |
| Sheets | MNK recharge helpers | MNK only | Find recharge columns/formulas and write eligible rows | No | MNK-specific destination and formulas | No | High | Remain app-specific unless recharge becomes a defined platform workflow. |
| Drive | `convertXlsxToGoogleSheet_` | All five | Convert incoming XLSX attachment to a Google Sheet | Yes — exact file | None found | Yes | Low | Strongest exact FIKA Core candidate; still requires error/cleanup contract. |
| Drive | `getOrCreateDriveFolder_`, `getOrCreateChildFolder_`, `extractDriveIdFromUrl_`, move/save helpers | All five | Resolve folders and store source, quote, PDF, and JSON files | Near | Naming, JSON/source retention, and Calendar attachment policies differ | Yes | Medium | Separate generic resolution from site folder policy. |
| Gmail | Query, scan, label, archive, message/attachment traversal | All five | Import booking emails in chunks and prevent duplicate processing | Near | The Line adds fingerprints, scan index, replacement and merge rules; MNK adds archive controls | Maybe | High | Share orchestration only after idempotency contract and fixtures. |
| Gmail | The Line fingerprint/index/revision functions | The Line | Match replacement forms and merge revised bookings | No | Unique to The Line source workflow | No | High | Concepts may later generalise, but current rules remain app-specific. |
| Calendar | Attendee parsing, title/start building, diagnostics | All five | Build Calendar event inputs | Near | MNK selection/labels/offset; configuration differences | Yes | Medium | Strong pure-helper candidates after policy separation. |
| Calendar | Create/reset and attachment workflow | All five | Create/remove events and attach quote/source/JSON files | Near | MNK refresh/patch path; The Line reduced JSON/file path; policy flags differ | Maybe | High | Centralise only behind a versioned workflow contract. |
| Quotes and Documents | Money/date/name/Drive/template helper functions | All five | Build quote names, folders, content, and PDF output | Near | Template structure and extended MNK/Demo reset/regeneration differ | Yes | Medium | Pure formatting and safe template utilities are strong candidates. |
| Quotes and Documents | `generateQuoteForRow` and template fill workflow | All five | Generate booking quote document/PDF and persist metadata | Near | Fees, template reset, print policy, regeneration, attachment refresh | Maybe | High | Pricing and document policy must remain explicit. |
| Email | Confirmation/cancellation subject, HTML, item rendering, escaping | All five | Send booking lifecycle emails | Near | Branding, recipients, enabled flags, and content differ | Yes | Medium | Share safe rendering; keep templates/policy configurable. |
| Logging | Scan-log keys and duplicate checks | All five | Record processed sources and prevent repeat imports | Near | The Line uses stronger fingerprint/index logic | Maybe | High | Define canonical idempotency/audit model before sharing. |
| Logging | `Logger` calls, actor/status metadata, test/live checklists | All five | Diagnostics and operational audit context | Near | Inconsistent events and fields | Yes | Medium | Candidate for a new structured logging contract, not direct code copying. |
| Triggers | `onOpen`, initialise settings, scan-trigger create/delete | Angel Court, CFC, Demo; near in MNK/The Line | Menus, initialisation, and scheduled scanning | Exact in Angel Court/CFC/Demo | MNK adds archive trigger; The Line adds ID repair | Yes | Medium | Trigger ownership and duplicate-install protection require review. |
| Feedback | `getHospitalityFeedbackMetrics` and helpers | Angel Court, CFC, MNK, Demo | Read and summarise feedback rows | Yes — exact file | Absent in The Line | Maybe | Medium | Audit with feedback application family before moving. |
| Client | UI state, rendering, filters, modals, settings, and remote-call wrappers in `Script.html` | All five | Browser application behaviour | Near | MNK/Demo extensions; The Line rescan; feedback absent in The Line | Maybe | High | First define UI modules and server contracts; current files are overloaded. |
| Booking Platform | `buildServerBooking_` | MNK, Angel Court, CFC, Demo Booking Platforms | Builds the authoritative server booking object from untrusted client payload | Near; exact in MNK/CFC | Angel Court validation extension; Demo post-submit feedback is outside builder | Yes | Medium | MNK is the preferred baseline. Must gain schema version, record version and policy references. |
| Booking Platform | `recalculateOrderItems_`, `validateChoices_` | All four Booking Platforms | Resolves requested item IDs against the site menu and rebuilds prices/options | Near | Site catalogues differ; service is exact MNK/CFC | Yes | Medium | Strong shared pricing boundary; catalogue remains tenant configuration. |
| Booking Platform | `validateBookingRequest_`, warning/lead-time helpers | All four Booking Platforms | Validates customer, event, item, dietary and acknowledgement rules | Near | Angel Court bespoke end-time rule and different large-event threshold | Yes | Medium | Use configurable policies and explicit site extensions. |
| Booking Platform | `generateBookingId_`, cleaning/date/integer/money helpers | All four Booking Platforms | Creates reference and normalises primitive values | Near | Prefix/timezone configuration | Yes | Medium | Approve stable ID/idempotency rules before adoption. |
| Booking Platform | `adaptClientBookingForDashboard_` | All four Booking Platforms | Converts authoritative booking object to current dashboard row/`ParsedJSON` projection | Near | Fee rates, separate Sheet arrangement and Demo compatibility differ | Maybe | High | Replace with a versioned dashboard ingestion contract; projection must not become authoritative. |
| Booking Platform | Sheet header map, assertion, duplicate-ID check and batch append helpers | All four Booking Platforms | Validates projection tabs and writes dashboard/item rows | Near | MNK/Demo can initialise headers and use separate booking spreadsheets | Yes | Medium | Duplicate scan is linear; future implementation should support idempotency/versioning. |
| Booking Platform | `getPublicPlatformConfig`, `buildPublicSiteConfig_`, `getPlatformSettings_` | All four Booking Platforms | Supplies menu, event types, rules, branding and settings to the browser | Near | Demo legacy-setting normalisation; site config differences | Yes | Medium | Safe/public config must remain separated from private integration configuration. |
| Booking Platform | Notification recipient parsing, message builders and escaping | All four Booking Platforms | Sends operational notification after successful submission | Near | Site copy and Demo line-item detail differ | Yes | Low | Keep recipient/copy policy tenant-specific. |
| Booking Platform | `doGet`, `include_` | All four Booking Platforms | Serves the HTML application | Yes — exact files | None found | Yes | Low | Exact shared entry point. |
| Booking Platform | Browser payload builder and form workflow | All four Booking Platforms | Collects common client/event/order/dietary/acknowledgement fields and submits once | Near | Angel Court presentation divergence; Demo branding | Maybe | Medium | Define UI modules after the canonical server contract; do not trust browser pricing. |
| Legacy Booking Adapter | Angel Court Gmail/XLSX parser-to-booking transformation | Angel Court Hospitality Dashboard fallback | Converts legacy email/form input into the canonical booking contract | Not implemented as one shared adapter yet | Legacy source-specific mapping and price provenance | Maybe | High | Preserve fallback; do not recreate form spreadsheets for new sites. |
| Booking Platform | Demo feedback service | Demo only | Sends demonstration feedback request after submission | No | Demo-only | No | Low | Must remain outside production booking rules. |

## Exact Duplicate Files

- `08_DriveHelper.js`: all five variants
- `appsscript.json` and `Icons.html`: all five variants
- `03_Utils.js`: Angel Court, CFC, MNK, Demo
- `13_Feedback.js`: Angel Court, CFC, MNK, Demo
- `11_Triggers.js`: Angel Court, CFC, Demo
- `04_Parser.js`: CFC, MNK, Demo
- `Index.html` and `Styles.html`: Angel Court and CFC
- `.claspignore`: CFC, MNK, Demo

Booking-platform exact duplicates:

- `04_Webapp.js`, `05_TestHarness.js`, and `appsscript.json`: MNK, Angel Court, CFC and Demo
- `02_BookingService.js`: MNK and CFC
- `.claspignore`: MNK, CFC and Demo

## App-Specific Functions to Preserve

- The Line form classification, sheet selection, parsing, fingerprints, revision matching/replacement, rescan, and legacy source mapping
- MNK recharge eligibility/mapping/write workflow
- MNK delivery-charge and total calculations
- MNK Calendar offset, attendee selection, quote-attachment refresh, bulk quote administration, and archive schedule
- Site branding, source labels, recipients, quote templates, print policy, pricing/fees, status extensions, and feature switches
- Demo-only branding and demonstration behaviour

## Next Evidence Needed

- Contract fixtures for each source-form layout and variant business rule
- Approved canonical booking/item/quote/Calendar objects
- Confirmed idempotency, concurrency, authentication, and rollback expectations
- A business-approved matrix of configuration differences versus true workflow differences
