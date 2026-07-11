# Hospitality Dashboard Family Report

## Scope and Method

This report is a read-only inspection of the five current Hospitality Dashboard variants in `C:\FIKA`. It uses source files, READMEs, manifests, clasp linkage, filenames, file sizes, function lists, and SHA-256 comparisons. It does not establish production URLs, deployment access, users, owners, criticality, dataset sizes, or measured performance.

No production code, Apps Script configuration, Git state, or deployment was changed. Script IDs, deployment IDs, production URLs, and secret values are omitted.

## Executive Summary

The five dashboards are separate Apps Script implementations of one recognisable product family. They share the same overall architecture, file naming, dashboard record model, settings system, Gmail import workflow, quote and PDF workflow, Calendar output, and HTML client. Several files are byte-for-byte identical and most others are close variants.

The code also contains genuine differences that should not be flattened prematurely:

- The Line has a distinct form parser and a more developed attachment revision/deduplication path.
- MNK has delivery-charge rules, richer quote regeneration, attendee selection and timing behaviour, archive scheduling, and a separate recharge workflow.
- Demo contains demonstration-specific branding and behaviour and is not evidence of a production business rule.
- Angel Court contains more defensive row-resolution logic than CFC.
- CFC remains unlinked to clasp locally and retains initial-setup placeholders.

The strongest near-term boundary is a shared Hospitality Dashboard product with site configuration and explicit extension points for parser, pricing, Calendar policy, quote policy, and post-confirmation workflows. Consolidation should begin with contracts and verified shared utilities, not a wholesale merge.

## Variant Overview

### Angel Court

1. **Path:** `C:\FIKA\sites\angel-court\dashboard`
2. **Likely purpose:** Site operations dashboard for importing hospitality booking forms, reviewing bookings, generating quotes/PDFs, creating Calendar events, sending confirmations and cancellations, and archiving records.
3. **Technology and structure:** Google Apps Script server-side JavaScript; Apps Script HTML service client (`Index.html`, `Script.html`, `Styles.html`, `Icons.html`); manifest; numbered service files; README, changelog, tests.
4. **Apps Script linkage:** `.clasp.json` present. Root deployment automation references this folder.
5. **Main data sources:** Active Google spreadsheet with `Dashboard Data` and settings-related tabs; Gmail messages and XLSX attachments; Drive source/quote/JSON files; Calendar events; feedback data.
6. **External integrations:** Google Sheets, Gmail, Drive, advanced Drive service, Google Docs/PDF generation, Calendar advanced service, and email sending.
7. **Hardcoded site configuration:** Site identity, Gmail label defaults, folder names, branding, email settings, Calendar/quote behaviour, status rules, automation flags, and an admin PIN hash are represented in source defaults; many are exposed through the Settings sheet.
8. **Shared/near-duplicate code:** Shares nearly the entire file structure with CFC, MNK, and Demo. Several files are exact duplicates; most core files are near duplicates.
9. **Variant behaviour:** More defensive update-row resolution by booking ID/source key and JSON-file synchronisation than CFC; feedback support present.
10. **Repeated functions:** Uses the shared settings, Sheets, Drive conversion, Gmail scan, quote/email, Calendar, trigger, feedback, and admin-PIN patterns described in the family analysis below.
11. **Likely bottlenecks:** Full dashboard read on client load; broad Gmail scan paths; repeated full-sheet parser reads; Drive folder-name lookups during quote generation. Actual impact is unmeasured.
12. **Large files:** `Script.html` about 1,431 lines; `Styles.html` about 1,209; `04_Parser.js` about 792; `00_config.js` about 655; `09_QuoteEngine.js` about 583.
13. **Client/server issues:** The client requests the complete dashboard dataset, then performs many separate remote actions. Admin PIN validation protects settings operations in the UI, but whole-app access control cannot be confirmed from source alone.
14. **Missing documentation:** No project-level `AGENTS.md`; no confirmed deployment/access model, ownership, dataset size, performance baseline, recovery procedure, or schema version.
15. **Consolidation opportunities:** Shared settings engine, dashboard repository functions, common parser helpers, scanner orchestration, quote/email helpers, Calendar helpers, UI shell, and feedback metrics.
16. **Early-consolidation risks:** Row-resolution and JSON synchronisation safeguards could be lost if the simpler CFC implementation becomes the baseline.
17. **Strong FIKA Core candidates:** Safe JSON parsing, settings validation, header maps, stable row lookup, booking validation, common date/time/money helpers, Drive folder resolution, email escaping, and Calendar attendee parsing.
18. **App-specific candidates:** Site defaults, source-form recognition/mapping, branding, recipients, quote template, Calendar policy, and site workflow switches.

### CFC

1. **Path:** `C:\FIKA\sites\cfc\dashboard`
2. **Likely purpose:** CFC site-manager dashboard for the same booking-to-quote-to-Calendar workflow.
3. **Technology and structure:** Same Apps Script HTML-service architecture and numbered files as Angel Court; tests and README present; no changelog found.
4. **Apps Script linkage:** No `.clasp.json` found. README instructs creation or linking of a new Apps Script project.
5. **Main data sources:** Intended active Google spreadsheet, Gmail/XLSX input, Drive files, Calendar, and feedback data.
6. **External integrations:** Google Sheets, Gmail, Drive, advanced Drive service, Google Docs/PDF generation, Calendar advanced service, and email sending.
7. **Hardcoded site configuration:** CFC site identity, processed Gmail label, folder/branding defaults, and an explicit replacement quote-template value; common settings and admin PIN hash are also in source defaults.
8. **Shared/near-duplicate code:** Closest variant to Angel Court. `03_Utils.js`, `08_DriveHelper.js`, `11_Triggers.js`, `13_Feedback.js`, `Index.html`, and `Styles.html` are exact matches; parser, scanner, quote, schema, tests, and config differ only modestly.
9. **Variant behaviour:** Printing contains an explicit disabled path; data/update logic is simpler than Angel Court; site setup is incomplete locally.
10. **Repeated functions:** Same common settings, Sheets, Drive, Gmail, Calendar, quote/email, feedback, and admin-PIN patterns.
11. **Likely bottlenecks:** Same family-wide full-load, scan, parser, and folder-lookup patterns. No measurements exist.
12. **Large files:** `Script.html` about 1,415 lines; `Styles.html` about 1,209; `04_Parser.js` about 792; `00_config.js` about 655; `09_QuoteEngine.js` about 580.
13. **Client/server issues:** Full dashboard payload on load and separate remote actions; deployment-level access is not documented.
14. **Missing documentation:** No clasp linkage, changelog, `AGENTS.md`, confirmed deployment/access, ownership, dataset scale, performance baseline, recovery process, or schema version.
15. **Consolidation opportunities:** Very high overlap with Angel Court makes this a strong configuration/tenant candidate.
16. **Early-consolidation risks:** CFC is not proven operationally complete; treating it as authoritative could propagate placeholders or omit Angel Court safeguards.
17. **Strong FIKA Core candidates:** Same common helpers as Angel Court.
18. **App-specific candidates:** CFC branding, source labels, quote template, recipients, and any confirmed CFC workflow policy.

### MNK

1. **Path:** `C:\FIKA\sites\mnk\dashboard`
2. **Likely purpose:** MNK hospitality operations plus site-specific recharge handling.
3. **Technology and structure:** Shared Apps Script architecture plus `14_RechargeService.js`; larger quote, Calendar, trigger, test, client, and style files.
4. **Apps Script linkage:** `.clasp.json` present. Coordinated root deployment automation references the dashboard and MNK booking platform.
5. **Main data sources:** Dashboard spreadsheet, Gmail/XLSX input, Drive quote/JSON/source files, Calendar, feedback data, and a separate recharge spreadsheet.
6. **External integrations:** Shared Google integrations plus the recharge-sheet workflow.
7. **Hardcoded site configuration:** MNK identity and labels, recharge sheet settings, recharge status, delivery-charge behaviour, archive controls, Calendar offset/attendee behaviour, and common settings/admin PIN defaults.
8. **Shared/near-duplicate code:** Common parser is an exact match with CFC and Demo; utilities, Drive conversion, feedback, manifest, and icons match other variants. Quote, Calendar, scanner, triggers, and client contain meaningful extensions.
9. **Variant behaviour:** Delivery-charge calculation; quote-template reset and bulk regeneration/audit tools; Calendar attendee selection, quote-attachment refresh and start offset; scheduled auto-archive; `RECHARGED` status and recharge-sheet synchronisation.
10. **Repeated functions:** Common family patterns plus MNK-specific recharge and extended quote/Calendar functions.
11. **Likely bottlenecks:** Family-wide issues plus cell-by-cell row reads in bulk quote tools and recharge synchronisation, and separate cell writes to the recharge sheet. Frequency and impact are unmeasured.
12. **Large files:** `Script.html` about 1,585 lines; `Styles.html` about 1,279; `09_QuoteEngine.js` about 787; `04_Parser.js` about 792; `00_config.js` about 663; `10_Calendar.js` about 475.
13. **Client/server issues:** Full dashboard payload; additional remote calls for MNK behaviours; pricing and Calendar policies are mixed into otherwise shared server/client files.
14. **Missing documentation:** Recharge workflow is absent from the README file-structure section; no `AGENTS.md`, deployment/access model, ownership, dataset scale, performance baseline, recovery process, or schema version.
15. **Consolidation opportunities:** Common product shell with explicit pricing, Calendar, quote, archive, and post-confirmation extension points.
16. **Early-consolidation risks:** Genericising MNK logic could alter recharge totals, quote regeneration, attachments, attendee selection, event timing, or archive behaviour.
17. **Strong FIKA Core candidates:** Common settings/repository/helpers plus idempotent quote attachment refresh and safe row/header utilities after contract review.
18. **App-specific candidates:** Recharge mapping, delivery-charge policy, Calendar offset/attendee choice, quote-regeneration administration, and MNK status transitions.

### Demo

1. **Path:** `C:\FIKA\sites\demo\dashboard`
2. **Likely purpose:** Sales demonstration and internal walkthrough of the dashboard family.
3. **Technology and structure:** Same Apps Script architecture, feedback support, and extended quote/Calendar code; minimal README.
4. **Apps Script linkage:** `.clasp.json` present. Root demo deployment automation references it.
5. **Main data sources:** Intended demo spreadsheet and the same Google service categories as other dashboards.
6. **External integrations:** Google Sheets, Gmail, Drive, advanced Drive service, Google Docs/PDF, Calendar advanced service, email, and feedback.
7. **Hardcoded site configuration:** Demo/FIKA branding, demo identity, feature defaults, and common settings/admin PIN defaults.
8. **Shared/near-duplicate code:** Parser matches CFC and MNK exactly; utility, Drive conversion, triggers, feedback, manifest, and icons match other variants. Extended quote/Calendar/client code is close to MNK.
9. **Variant behaviour:** Demo-specific branding and a demo delivery-charge test/path; management-fee and demo workflow choices are not production rules.
10. **Repeated functions:** Same family settings, Sheets, Drive, Gmail, Calendar, quote/email, feedback, and admin-PIN patterns.
11. **Likely bottlenecks:** Same family-wide patterns. Demo data size and operational impact are unknown.
12. **Large files:** `Script.html` about 1,549 lines; `Styles.html` about 1,272; `04_Parser.js` about 792; `09_QuoteEngine.js` about 752; `00_config.js` about 672.
13. **Client/server issues:** Full dashboard payload and many remote actions; demo-specific behaviour sits inside product-like files.
14. **Missing documentation:** README is only a short summary; no detailed architecture, deployment/access, data contract, `AGENTS.md`, performance baseline, or intended parity policy.
15. **Consolidation opportunities:** Useful regression/reference tenant after production contracts are established.
16. **Early-consolidation risks:** Demo behaviour must not become the source of production business rules.
17. **Strong FIKA Core candidates:** Only utilities already verified against production variants.
18. **App-specific candidates:** Demo branding, sample data/settings, and demonstration-only behaviour.

### The Line

1. **Path:** `C:\FIKA\sites\58-victoria-embankment\dashboard` (legacy folder name retained; business name is The Line)
2. **Likely purpose:** The Line hospitality booking operations using a distinct incoming form layout and revision-handling workflow.
3. **Technology and structure:** Same Apps Script architecture; no feedback service file; larger parser/scanner; changelog and detailed README present.
4. **Apps Script linkage:** `.clasp.json` present. No dedicated root deployment script was found.
5. **Main data sources:** Dashboard spreadsheet, Gmail messages and XLSX attachments, Drive files, and Calendar.
6. **External integrations:** Google Sheets, Gmail, Drive, advanced Drive service, Google Docs/PDF generation, Calendar advanced service, and email sending.
7. **Hardcoded site configuration:** Site/partner branding and logo defaults, identity and labels, common workflow settings, and common admin PIN defaults. Source code and function names still contain legacy `58Ve` terminology.
8. **Shared/near-duplicate code:** Drive conversion, manifest, and icons are exact family matches; quote engine is very close to Angel Court/CFC. Parser, scanner, Calendar, triggers, utilities, data layer, and client have larger divergences.
9. **Variant behaviour:** Dedicated form classification/sheet selection/line-item parsing; attachment fingerprints and scan indexes; matching and replacement of revised bookings; manual rescan comparison; booking-ID repair; simpler Calendar file handling; no local feedback module.
10. **Repeated functions:** Common settings, Sheets, Drive conversion, shared quote/email helpers, and partial Calendar/scanner patterns; parser and revision logic are materially variant-specific.
11. **Likely bottlenecks:** Family-wide full dashboard load and folder lookup; scanner can search large Gmail result sets and build a dashboard scan index; parser performs several full range/display-range passes. These are suspected bottlenecks until measured.
12. **Large files:** `Script.html` about 1,444 lines; `Styles.html` about 1,113; `04_Parser.js` about 1,003; `00_config.js` about 657; `09_QuoteEngine.js` about 578; `05_GmailScanner.js` about 536.
13. **Client/server issues:** Full dashboard payload; rescan/revision operations cross the remote boundary; deployment access is undocumented.
14. **Missing documentation:** Folder, parser functions, and changelog retain legacy venue terminology; no `AGENTS.md`, confirmed lifecycle/deployment/access, ownership, dataset scale, performance baseline, recovery process, or schema version.
15. **Consolidation opportunities:** Share the product shell, record contract, settings, quote/email, Drive conversion, and common utilities while retaining a parser/revision adapter.
16. **Early-consolidation risks:** Replacing its scanner/parser with the common variant would lose revision detection, duplicate matching, and its source-form contract.
17. **Strong FIKA Core candidates:** Common utility/settings/quote helpers, plus generic fingerprinting/index concepts after they are specified independently of The Line forms.
18. **App-specific candidates:** Form classification, sheet selection, legacy source mapping, revision replacement policy, partner branding, and rescan behaviour.

## Family Comparison

### Exact Duplicates

Confirmed byte-for-byte duplicates, excluding clasp linkage:

- `08_DriveHelper.js` across all five variants.
- `appsscript.json` and `Icons.html` across all five.
- `03_Utils.js` across Angel Court, CFC, MNK, and Demo.
- `13_Feedback.js` across Angel Court, CFC, MNK, and Demo; The Line has no corresponding file.
- `11_Triggers.js` across Angel Court, CFC, and Demo.
- `04_Parser.js` across CFC, MNK, and Demo.
- `Index.html` and `Styles.html` across Angel Court and CFC.
- `.claspignore` across CFC, MNK, and Demo.

### Near Duplicates

- `00_config.js`, `02_Schema.js`, `05_GmailScanner.js`, `06_DataLayer.js`, `07_Webapp.js`, `09_QuoteEngine.js`, `10_Calendar.js`, `12_TestHarness.js`, and `Script.html` all share recognisable structure and function names.
- Angel Court and CFC are the closest pair overall.
- MNK and Demo share the extended quote/Calendar/client branch, but MNK contains real operational extensions.
- The Line quote engine remains close to Angel Court/CFC while its parser/scanner diverge substantially.

### Configuration-Only or Predominantly Configurational Differences

- Site identity and display name
- Location code and default location/floor
- Branding, colours, logos, favicon, fonts, and “about” content
- Processed Gmail label
- Root/quote folder names
- Email recipients and printer address
- Calendar identifiers, attendees, title format, duration, colour, and attachment flags
- Quote template and quote/Calendar sequencing flags
- Archive thresholds, visibility flags, and automation switches

Many of these appear in the common settings schema and are therefore strong configuration candidates. Whether every current value should remain configurable requires business confirmation.

### Genuine or Likely Business-Rule Differences

- The Line source-form recognition, parsing, revision matching, duplicate replacement, and rescan policy.
- MNK delivery-charge calculation and totals.
- MNK recharge eligibility, destination mapping, status, formula handling, and synchronisation.
- MNK Calendar attendee selection, start offset, quote-attachment refresh, and scheduled archive behaviour.
- Whether printing is enabled in each variant.
- Demo-only pricing/branding/feedback behaviour, which must not be treated as a production rule.
- Exact confirmation prerequisites, management fees, archive policy, Calendar attachments, and automation modes require confirmation even where represented as configuration.

## Repeated Function Families

| Area | Repeated functions/patterns | Evidence | FIKA Core suitability | Keep app-specific |
|---|---|---|---|---|
| Configuration | `getSettings_`, settings schema/default creation, validation, import/save, typed getters, URL/email validation | Same function set in all variants; small config diffs | Strong | Site defaults, editable-field policy, workflow switches |
| Sheets access | `getDashboardSheet_`, header maps, required-header checks, row serialisation, record lookup | Same concepts in every data layer | Strong after canonical row contract | Extra columns, The Line revision fields, MNK recharge mapping |
| Drive | `convertXlsxToGoogleSheet_`, folder creation/lookup, file movement, ID extraction | Converter exact across all; quote helpers near-identical | Strong | Folder naming policy and source-file retention rules |
| Gmail | Query construction, processed labels, chunk scanning, archive checks, message/attachment traversal | Common scanner structure; The Line branch is materially extended | Scanner framework: Maybe | Query policy, form classifier/parser, revision replacement |
| Calendar | Title/start construction, attendee parsing, create/reset, original/quote attachments, diagnostics | Repeated across all with MNK and The Line divergence | Common helpers: Strong; full workflow: Maybe | Attendee choice, offsets, attachment policy, refresh behaviour |
| PDF/quotes | Money/date formatting, template replacement, folder resolution, naming, PDF generation, email HTML/escaping | Large near-duplicate quote engines | Helpers: Strong; workflow after contract review | Template layout, pricing, management/delivery fees, print policy |
| Logging | Scan-log writes, audit metadata, `Logger` use, test/live checklists | Present but inconsistent and not a shared structured contract | Strong candidate for new shared contract | Site-specific operational messages only |
| Authentication | `verifyAdminPin`, hashing, active-user attribution | Same pattern across all configs; deployment access not documented | Maybe, only after security design | Deployment audience and site permission policy |

## Client/Server Boundary

Confirmed observations:

- `getDashboardBookings()` reads the complete `Dashboard Data` range and returns normalised rows to the browser on initial load.
- Each client contains roughly 15–17 `google.script.run` call sites for load, settings, updates, quote, Calendar, confirmation, cancellation, scan, and related actions.
- Mutation workflows accept browser-supplied row numbers and/or booking identifiers, then re-read server state before writing. Angel Court contains additional stable-row resolution logic.
- Settings authentication is performed through a server function, but the source does not establish the deployment audience or whether all operational methods require authenticated users.
- Large client files combine state, rendering, filters, modals, settings, remote calls, and workflow orchestration.

Risks and questions:

- Full-history payload size will grow with the dashboard sheet unless archived rows are excluded or loading becomes incremental.
- Multiple independent remote calls may create visible latency, but timings have not been measured.
- Row-number addressing can become stale after sorting or concurrent writes; stable booking IDs should be authoritative wherever available.
- TODO: Confirm deployment access, authorised user groups, and whether the admin PIN is intended only for settings or as a broader control.

## Candidate Canonical Objects

The code implies, but does not yet formally define:

- `FikaBooking`: booking ID, source key/type, customer/contact, site/location, date/times, pax, items, notes, dietary data, totals, status, source metadata, quote metadata, Calendar metadata, confirmation/cancellation metadata, audit fields, and version/revision information.
- `FikaBookingItem`: section/category, item name, quantity, time, detail/instructions, comment, unit/net price, and dietary/product metadata.
- `FikaCustomer`: name, organisation, email, phone, and booking contact context.
- `FikaQuote`: quote identity/status, template, totals/tax/fees, file references, generation timestamp, and relationship to a booking version.
- `FikaCalendarEvent`: event identity, Calendar reference, title, start/end, attendees, attachments, colour, and relationship to a booking version.
- `FikaAppConfig` / `FikaSite`: site identity, branding, spreadsheet/folder/Calendar references, recipients, workflow flags, and enabled features.
- `FikaAuditEvent`: actor, action, timestamp, booking identity, prior/new status, scan source, and diagnostic outcome.
- `FikaMediaAsset`: source XLSX, booking JSON, quote document/PDF, logos, and attachment references.

These are candidates only; required fields, ownership, and source-of-truth rules remain TODO.

## Performance Findings

### Confirmed Code Patterns

- Every dashboard load reads the full dashboard data range.
- Settings helpers perform full settings-sheet reads; The Line contains a cache token not present in the other configs, but cache behaviour requires separate verification.
- Shared parsers repeatedly request full data and display ranges from converted booking sheets.
- Gmail scanners include searches of up to hundreds of threads and iterate messages and attachments.
- Quote generation resolves Drive folders by name.
- Feedback metrics read the full feedback sheet in variants with feedback support.
- MNK bulk quote utilities and recharge synchronisation contain row-by-row Sheet reads; recharge writes individual cells.
- The Line parser performs several full-range passes and its scanner builds indexes for matching revisions.

### Suspected Impact

- Initial load, inbox scan, import, bulk quote maintenance, feedback metrics, and recharge sync may slow as datasets grow.
- Drive name searches may become slower or ambiguous as folder counts grow.
- Duplicate full-range reads during parsing may add avoidable Apps Script service calls.
- Large client and server files increase change/regression risk even when runtime impact is modest.

No delay, call-duration, dataset-size, or business-impact measurement was available. All runtime impact remains suspected until measured.

## Consolidation Direction

### Current Opportunities

1. Define and validate the canonical dashboard booking contract before moving code.
2. Establish a shared configuration schema with explicit per-site overrides.
3. Extract only verified exact/common utilities first: safe parsing, validation, date/time/money helpers, header maps, Drive conversion, folder resolution, email escaping, and attendee parsing.
4. Define adapter boundaries for source-form parsing and revision handling.
5. Define policy boundaries for pricing, quote layout, Calendar behaviour, printing, archive, feedback, and recharge.
6. Add contract/regression fixtures for every variant before centralising workflows.

### Risks of Consolidating Too Early

- Silent changes to pricing, fees, tax, quote layout, Calendar timing/attachments, email recipients, or status transitions.
- Loss of The Line revision/deduplication behaviour.
- Loss of MNK recharge, delivery-charge, quote-refresh, attendee, or archive behaviour.
- Treating demo behaviour as production truth.
- Coupling all sites to one release without rollback and compatibility controls.
- Propagating current hardcoded defaults or authentication assumptions across every tenant.
- Centralising around an unstable spreadsheet column contract before canonical schemas exist.

## Missing Documentation Across the Family

- Project-level `AGENTS.md` files
- Confirmed lifecycle, owners, users, criticality, and support contacts
- Deployment audience and authentication/authorisation model
- Production deployment and rollback procedure
- Exact spreadsheet tab ownership and schema/version rules
- Data retention, backup, recovery, and archive behaviour
- Expected dataset size and measured performance baseline
- External failure behaviour for Gmail, Drive, Calendar, and email
- Idempotency and concurrency guarantees
- Complete variant matrix for pricing, quote, Calendar, printing, feedback, archive, and recharge behaviour
- The Line terminology migration plan for legacy folder/function names

## Manual Questions

1. What is the lifecycle status of Angel Court, MNK, and The Line dashboards, and is CFC still Development?
2. Who may access each dashboard and how is access controlled at deployment level?
3. Is the admin PIN only for settings, and should the shared hash/default remain in source?
4. Which spreadsheet is authoritative for each site, and which tabs are reports, admin surfaces, or caches?
5. What are the typical and maximum dashboard, scan-log, settings, and feedback row counts?
6. Which pricing, management-fee, delivery-charge, VAT, print, archive, Calendar, and confirmation rules are approved per site?
7. Is MNK recharge still required, and what guarantees prevent duplicate recharge rows?
8. Which The Line revision should win when multiple forms represent the same booking?
9. Should feedback support be added to The Line or intentionally remain absent?
10. Should site variants share one release cadence or remain independently deployable tenants?
