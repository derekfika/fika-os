# Integration Inventory

## CPU Production Dashboard integrations

| Integration | Direction | Confirmed use | Boundary |
|---|---|---|---|
| Google Calendar advanced service | Inbound | Paged incremental/deep discovery of hospitality and delivery events | Current adapter; future identity should use booking/production-order IDs |
| Google Drive | Inbound/outbound | Read attachments, inspect modification time, convert Office files, store prep/allergen evidence | References and diagnostics are integration/audit metadata |
| Google Docs, Sheets and Slides services | Inbound | Extract legacy quote/form text and tables | Legacy adapters, not canonical contracts |
| CPU operational Sheets | Internal read/write | Orders, Deliveries, Settings and Scan Log projections | Operational, non-transactional projection |
| Gmail | Upstream only | No Gmail service use found in CPU | Legacy email should be normalised before CPU consumption |
| Canonical booking ingestion | Planned boundary | No direct `FikaBooking` v1 API/message consumer found | Needs idempotent, versioned booking-to-production transformation |

## Status

Confirmed integrations from the Hospitality Dashboard and Booking Platform source families. Authentication values, script IDs, deployment IDs, and production URLs are excluded.

| Integration ID | Provider | Used by | Purpose | Read or write | Authentication location | Current provider | Target provider | Migration status | Risk | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `hospitality-booking-object-publish` | FIKA internal contract; Google Sheets is the current dashboard transport | MNK, Angel Court, CFC and Demo Booking Platforms; Hospitality Dashboard consumers | Publishes authoritative booking objects into a dashboard operational projection | Write from platform; read/operate in dashboard | Apps Script execution identity/OAuth for current transport; future contract authentication TODO | Direct dashboard Sheet write with nested booking JSON | Versioned canonical booking contract | Planning | Medium | MNK is the preferred baseline. Dashboard must consume objects rather than reconstruct them. Physical transport may evolve without changing the canonical contract. |
| `hospitality-google-sheets` | Google Sheets | All five Hospitality Dashboards and four Booking Platforms | Dashboard projections, settings, structured line-item views, logs, feedback metrics and MNK recharge data | Both | Apps Script execution identity/OAuth; exact deployment account TODO | Google | TODO | TODO | TODO | Booking-platform Sheets other than configuration are operational views/projections, not the authoritative booking source. |
| `hospitality-gmail` | Gmail | All five Hospitality Dashboards | Finds booking emails and XLSX attachments; applies processed labels | Both | Apps Script execution identity/OAuth; exact deployment account TODO | Gmail | TODO | TODO | TODO | Search queries, limits, labels, and archive behaviour are configurable or source-defined. The Line adds revision matching. |
| `hospitality-google-drive` | Google Drive | All five Hospitality Dashboards | Converts XLSX files, resolves folders, stores quote/source/JSON files, and supplies Calendar attachments | Both | Apps Script execution identity/OAuth; advanced Drive service enabled | Google Drive | TODO | TODO | TODO | Exact `convertXlsxToGoogleSheet_` implementation is shared by all five. Folder-name lookup is used by quote workflows. |
| `hospitality-google-docs-pdf` | Google Docs/Drive | All five Hospitality Dashboards | Copies/fills quote templates and produces quote documents/PDFs | Both | Apps Script execution identity/OAuth; template references in settings | Google | TODO | TODO | TODO | Template layout, pricing, fees, naming, and print policy vary. Production template identifiers are omitted. |
| `hospitality-google-calendar` | Google Calendar | All five Hospitality Dashboards | Creates, updates, removes, and diagnoses booking events and attachments | Both | Apps Script execution identity/OAuth; advanced Calendar service enabled | Google Calendar | TODO | TODO | TODO | MNK has attendee selection, offset and quote-attachment refresh; The Line has a reduced file/JSON Calendar path. |
| `hospitality-email` | Gmail/Mail service | Hospitality Dashboards and MNK, Angel Court, CFC, Demo Booking Platforms | Sends dashboard lifecycle emails and post-submission operational notifications | Write | Apps Script execution identity/OAuth; recipients/settings in configuration | Google mail services | TODO | TODO | TODO | Booking submission notification occurs after persistence and does not roll back a saved booking. Customer confirmation ownership remains a dashboard/workflow question. |
| `hospitality-feedback` | Google Sheets and email workflow | Angel Court, CFC, MNK, Demo dashboards | Reads feedback metrics produced by the separate feedback workflow | Read in dashboard family | Apps Script execution identity/OAuth; exact feedback binding TODO | Google | TODO | TODO | TODO | Shared feedback module is absent from The Line. Relationship to the separate feedback portal should be verified in its own family audit. |

## Authentication and Access Questions

- TODO: Confirm deployment audience, executing account, and permission boundaries for every dashboard.
- TODO: Confirm whether the server-side admin PIN is intended only for settings and whether its source default should be replaced by secure configuration.
- TODO: Confirm Google service quotas, failure behaviour, retry expectations, and operational ownership.
- TODO: Confirm no non-Google integration is hidden behind production configuration; none was found in the inspected dashboard source.
