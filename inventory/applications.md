# Application Inventory

## Inventory Basis

This draft combines confirmed decisions with evidence found in the local `C:\FIKA` workspace on 11 July 2026. Evidence includes repository structure, project READMEs, Apps Script manifests, clasp metadata, deployment scripts, filenames, and local Git history.

The workspace contains one Git repository at `C:\FIKA`. Existing application folders are projects within that repository, not separate Git repositories. Apps Script IDs and deployment IDs are deliberately not reproduced. A clasp link or deployment script is evidence of deployment capability, not proof of lifecycle status.

Lifecycle values are `Live`, `Pilot`, `Development`, `Planned`, and `Archived`. Platform relationships are `Core platform`, `Client-specific implementation`, `Shared utility`, `Future platform capability`, and `Outside scope`. `TODO` is used whenever Derek's confirmation is still required.

## Applications and Planned Capabilities

| App ID | App name | Lifecycle status | Platform relationship | Consolidation candidate | Purpose | Users | Site or scope | Repository | Apps Script project | Deployment | Frontend | Data source | Connected apps | Criticality | Health | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `angel-court-booking-platform` | FIKA Client Hospitality Booking Platform — Angel Court | Live | Client-specific implementation | Yes | Authoritative client-facing booking submission with server-side validation, pricing, canonical booking-object creation, and dashboard projection | TODO | Angel Court | `C:\FIKA\sites\angel-court\booking-platform` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Authoritative booking-object JSON; operational Settings and line-item Sheets; site menu schema | Angel Court Hospitality Dashboard; email notifications | TODO | TODO | Direct platform is preferred. Legacy inbox scanning remains a fallback and should normalise to the same canonical object. Potential tenant of the MNK-based shared product. |
| `angel-court-hospitality-dashboard` | Hospitality Dashboard — Angel Court | TODO | Client-specific implementation | Yes | Hospitality booking review, quote, Calendar, confirmation, and archive workflows | TODO | Angel Court | `C:\FIKA\sites\angel-court\dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Canonical booking-object input and operational Sheet projection; legacy Gmail/XLSX fallback; Drive files | Gmail, Drive, Google Sheets, Calendar, booking platform, feedback support | TODO | TODO | Must consume canonical booking objects from the preferred direct platform path. Legacy inbox scanning remains a supported adapter, not an alternative source of truth. |
| `the-line-hospitality-dashboard` | The Line Hospitality Dashboard | TODO | Client-specific implementation | Yes | Hospitality booking review, quote, Calendar, confirmation, and archive workflows | TODO | The Line | `C:\FIKA\sites\58-victoria-embankment\dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Legacy Gmail booking forms; operational dashboard Sheet projection; Drive files | Gmail, Drive, Google Sheets, Calendar | TODO | TODO | No separate direct booking platform was found. The Line is not the standard-hospitality baseline; Events Dashboard work takes priority over further The Line development. |
| `cfc-booking-platform` | CFC Hospitality Booking Platform | Development | Client-specific implementation | Yes | Built but non-live client-facing booking implementation using the shared direct booking-object flow | TODO | CFC | `C:\FIKA\sites\cfc\booking-platform` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Booking-object JSON; operational Settings and line-item Sheets; CFC brochure-derived menu schema | CFC Hospitality Dashboard | TODO | TODO | Booking service is an exact match with MNK. Candidate future tenant of the MNK-based shared product. “Development” represents confirmed built-but-not-live status pending any more precise lifecycle decision. |
| `cfc-hospitality-dashboard` | CFC Hospitality Dashboard | Development | Client-specific implementation | Yes | Hospitality booking review, quotes, Calendar creation, confirmation, printing, archiving, and feedback | TODO | CFC | `C:\FIKA\sites\cfc\dashboard` | No `.clasp.json` found | TODO | Apps Script HTML/JavaScript web app | Canonical booking-object input and intended operational Sheet projection; Drive files | Gmail, Drive, Google Sheets, Calendar, CFC booking platform | TODO | TODO | Built but not live. Future dashboard should consume the booking platform's canonical object; no new booking-form spreadsheet should be introduced by default. |
| `demo-booking-platform` | FIKA Hospitality Booking Platform — Demo | Development | TODO | Yes | Sales and tender demonstration of the direct hospitality booking-object flow | TODO | Demo | `C:\FIKA\sites\demo\booking-platform` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Demo booking-object JSON; operational Settings/line-item Sheets; demo menu/configuration | Demo Hospitality Dashboard; feedback preview; email | TODO | TODO | Demonstration tenant, not a source of production business rules. Adds demo feedback behaviour to the otherwise shared submission flow. |
| `demo-hospitality-dashboard` | FIKA Hospitality Dashboard — Demo | Development | TODO | Maybe | FIKA-branded demonstration of booking review, quotes, Calendar, confirmation, settings, and feedback | TODO | Demo | `C:\FIKA\sites\demo\dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Demo canonical booking-object input and operational Sheet projection | Demo booking platform; Google services used by the shared dashboard workflow | TODO | TODO | Sales/tender demonstration only; must not define production booking or dashboard rules. |
| `mnk-booking-platform` | Fika at MNK Hospitality Booking Platform | Live | Client-specific implementation | Yes | Authoritative direct hospitality booking platform and preferred baseline for shared-product consolidation | TODO | MNK | `C:\FIKA\sites\mnk\booking-platform` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Authoritative booking-object JSON; operational Settings and line-item Sheets; MNK brochure-derived menu schema | MNK Hospitality Dashboard; email notifications | TODO | TODO | Does not depend on a booking-form spreadsheet. Sends booking-object JSON directly to the dashboard projection and is the preferred consolidation baseline. |
| `mnk-client-hospitality-portal` | MNK Client Hospitality Portal | TODO | Client-specific implementation | Maybe | Read-only confirmed-booking history portal with server-side PIN access | TODO | MNK client-facing | `C:\FIKA\sites\mnk\client-dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | MNK dashboard spreadsheet | MNK Hospitality Dashboard; optional booking-platform link | TODO | TODO | README confirms sanitised read-only booking history and a separate web-app deployment model. Root deployment automation exists. |
| `mnk-hospitality-dashboard` | Fika at MNK Hospitality Dashboard | TODO | Client-specific implementation | Yes | Hospitality booking review, quotes, Calendar creation, confirmation, printing, archiving, feedback, and recharge handling | TODO | MNK | `C:\FIKA\sites\mnk\dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Authoritative booking-object input from MNK platform; operational Sheet projection; Drive files | Gmail, Drive, Google Sheets, Calendar, MNK booking platform, feedback support | TODO | TODO | Preferred dashboard consumer for the MNK booking-platform baseline. Delivery-charge and recharge ownership must be resolved without making the Sheet projection authoritative. |
| `client-feedback-portal` | FIKA Multi-Site Hospitality Feedback Portal | TODO | Shared utility | No | Shared feedback requests, responses, and item ratings for registered hospitality dashboards | TODO | Multi-site | `C:\FIKA\shared\client-feedback-portal` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Registered hospitality dashboard spreadsheets; Script Properties for connections | Hospitality dashboards; email notifications | TODO | TODO | README describes one multi-site web app and trigger. Root deployment automation and a local deployment-ID file are present. |
| `feedback-reporting-dashboard` | Hospitality Feedback Reporting Dashboard | TODO | Shared utility | No | Cross-site feedback reporting with filters, KPIs, comparisons, comments, CSV, and PDF exports | TODO | Company-wide hospitality reporting | `C:\FIKA\shared\feedback-reporting-dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Hospitality dashboard spreadsheets | Hospitality feedback data across configured sites | TODO | TODO | README says some sites are configured and others still require wiring. Root deployment automation exists. |
| `cpu-production-dashboard` | CPU Production Dashboard | TODO | Core platform | No | Production planning from multi-site hospitality and delivery events, attached documents, and normalised production data | TODO | Company-wide CPU production | `C:\FIKA\shared\cpu-dashboard` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app; local Node preview helper only | Google Calendar events; Google and Microsoft Office attachments; cached Google Sheets data; Drive uploads | Hospitality and CPU calendars, Drive, Google Sheets, attached quote and booking documents | TODO | TODO | README documents a current build, kitchen workflows, delivery records, and incremental scanning. Root deployment automation exists. |
| `workforce-operations-platform` | FIKA Workforce Operations Platform | TODO | Core platform | No | Rota management, relief planning, agency tracking, legacy rota import, gap detection, and BrightHR sync | TODO | Company-wide workforce operations | `C:\FIKA\shared\workforce-operations-platform` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Google Sheets; legacy rota workbooks; BrightHR data | BrightHR API, Google Sheets, Drive | TODO | TODO | Provisionally in scope pending manual review. README calls it a starter project; code and root deployment automation are present. |
| `munich-hot-drinks-tally` | Munich RE Hot Drink Tally | Live | Client-specific implementation | Maybe | Tablet tally for hot-drink activity with queued sync, undo and audit records, and archived daily data | TODO | Munich RE | `C:\FIKA\shared\munich-hot-drinks` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Google Sheets live data; Drive JSON archives; browser-local queue | Munich RE Hot Drink Reporting | TODO | TODO | Confirmed in scope and live as client-specific operational reporting. Separate tally and reporting deployments share data. Root deployment automation exists. |
| `munich-hot-drinks-reporting` | Munich RE Hot Drink Reporting | Live | Client-specific implementation | Maybe | Desktop reporting and administration for hot-drink data, including summaries, heatmaps, CSV, PDF, settings, and archive reads | TODO | Munich RE | `C:\FIKA\shared\munich-hot-drinks-reporting` | Linked through `.clasp.json` | TODO | Apps Script HTML/JavaScript web app | Shared Google Sheet; Drive JSON archives | Munich RE Hot Drink Tally | TODO | TODO | Confirmed in scope and live as client-specific operational reporting. README explicitly separates reporting from the tally. Root deployment automation exists. |
| `events-dashboard` | Events Dashboard | Planned | Future platform capability | No | Internal company-wide source of truth for events from all confirmed channels | TODO | Company-wide | No local repository found | None found | TODO | TODO | TODO | TODO | TODO | TODO | Planned capability; repository, technology, deployment, data sources, and integrations are not yet confirmed. |
| `fika-events-popups-public-platform` | FIKA Events and Pop-ups Public Platform | Planned | Future platform capability | No | Separate public experience feeding shared internal event operations | TODO | Public, company-wide offering | No local repository found | None found | TODO | TODO | TODO | TODO | TODO | TODO | Planned capability; must remain a distinct public experience from The Line. |
| `the-line-public-experience` | The Line Public Experience | Planned | Future platform capability | No | Separate client-facing event experience feeding the shared Events Dashboard | TODO | The Line public channel | No local repository found | None found | TODO | TODO | TODO | TODO | TODO | TODO | Planned capability; distinct from the existing The Line Hospitality Dashboard stored under the former venue path. |
| `logistics-dashboard` | Logistics Dashboard | Planned | Future platform capability | No | Shared operational capability for logistics workflows | TODO | Company-wide logistics | No local repository found | None found | TODO | TODO | TODO | TODO | TODO | TODO | Planned capability; no local implementation evidence was found. |
| `till-provider-abstraction` | Till-provider Abstraction | Planned | Future platform capability | No | Provider-independent platform capability supporting till operations and migration | TODO | Company-wide | No local repository found | None found | TODO | TODO | TODO | TODO | TODO | TODO | Planned capability covering Square, SumUp, and Goodtill where applicable; implementation details are not yet confirmed. |

## Likely Shared Products Represented by Site Variants

- A shared hospitality booking product is represented by the separate Angel Court, CFC, MNK, and demo booking-platform implementations.
- A shared hospitality dashboard product is represented by the separate Angel Court, The Line, CFC, MNK, and demo dashboard implementations.
- Current site variants remain separate implementations. Their future treatment as configurations or tenants must be gradual and must not imply immediate consolidation or removal.
- The MNK client portal may represent a reusable client booking-history capability, but this requires confirmation before it is treated as a shared product.

## Planned Capabilities With No Repository Yet

- Events Dashboard
- FIKA Events and Pop-ups public platform
- The Line public experience
- Logistics Dashboard
- Till-provider abstraction

These are confirmed planned platform capabilities. No local repository, production deployment, or implementation is asserted for them.

## Archive Items Awaiting Retention Decisions

The following items under `C:\FIKA\archives` are retained pending review and must not be marked for deletion:

- `client-booking-platform.zip`
- `munich-hot-drinks-reporting.zip`
- Five ZIP snapshots named for the Workforce Operations Platform
- `bat`, an empty file whose intended purpose is unknown

These may be historical snapshots of current source folders, but their contents and retention requirements have not been confirmed.

## Factual Questions Requiring Derek's Confirmation

- What is the lifecycle status of each existing project not already confirmed as `Live` or `Development`?
- Who uses each application, and who owns it operationally and technically?
- What is each application's business criticality and current health?
- What are the production deployment URLs? These should be recorded only after confirmation and without exposing secrets.
- Is The Line Hospitality Dashboard currently live, pilot, in development, archived, or another permitted lifecycle state?
- Should the demo booking platform and dashboard be classified as `Shared utility`, `Outside scope`, or another platform relationship?
- Is the CFC Hospitality Dashboard still in development?
- What is the current maturity and lifecycle status of the provisionally in-scope Workforce Operations Platform?
- Should the MNK Client Hospitality Portal become a shared product or remain client-specific?
- Are there additional active repositories or projects for Events, public experiences, logistics, or till migration outside `C:\FIKA`?
- What retention rules apply to each archive ZIP and the empty `archives\bat` file?

Bloom and HomeBuck remain outside the FIKA Platform scope and are not included as application rows.

## CPU Production Dashboard Audit Addendum

The detailed evidence is in `inventory/reports/cpu-production-dashboard.md`. The application lifecycle remains `TODO`: code and documentation confirm a substantive application, but not production deployment or current users.

- Current ingestion is Calendar-led. Attached booking JSON is preferred; quote and legacy booking-form documents are fallback adapters.
- CPU Orders and CPU Deliveries Sheets are operational projections, not canonical commercial sources.
- CPU readiness/preparation state is distinct from canonical booking status.
- Production is currently aggregated by normalised display name and site; stable production-order/line identities are a consolidation prerequisite.
