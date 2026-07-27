# Current System Map

## Status and evidence boundary

This map describes only relationships confirmed by the Stage 1 inventories and hospitality/CPU audits. It does not assert production URLs, deployment state, owners, users, volumes, or criticality where those facts remain TODO.

## Classification

- **Canonical record:** the authoritative representation of a business concept. The Hospitality Booking Platform is confirmed as the authority for hospitality bookings. Pack 4 provides the governed Booking contract evidence; the earlier standalone `FikaBooking` aggregate remains a supporting draft requiring later reconciliation.
- **Operational projection:** a derived representation used to operate, report, cache, or audit work. It can be rebuilt or reconciled from its authority and must not silently become a competing truth.
- **Legacy adapter:** a transitional component that reconstructs or normalises business facts from an older channel or layout.

## Current platform overview

The current workspace contains site-specific Hospitality Booking Platforms and Hospitality Dashboards, shared hospitality utilities, the CPU Production Dashboard, workforce and client-specific reporting tools, and planned capabilities without repositories. Hospitality variants share substantial code but remain separate current implementations.

MNK is the preferred direct-booking baseline. Angel Court supports direct booking and retains a legacy inbox adapter. CFC is built but not live. Demo supports sales and tender demonstrations. The Line has a hospitality dashboard but is not the standard booking baseline.

## Stage 6 current-system classification

The classifications below describe evidenced responsibility, not implementation quality or retirement approval.

| Current system or family | Confirmed classification | Canonical authority assessment | Transition status |
|---|---|---|---|
| Hospitality Booking Platforms | Canonical authority for hospitality Booking; operational system of execution | Confirmed for the Booking object; durable physical repository and version-delivery mechanism remain TODO | Site variants coexist; MNK is the preferred direct baseline |
| Hospitality Dashboards | Operational system of execution; read/operational projection | Not authoritative for commercial Booking status | Continue while object consumption and projection write boundaries are introduced |
| Angel Court inbox scanner | Legacy transition partner and ingestion adapter | Gmail message is provenance, not the Booking authority | Retained fallback; normalise into the Booking contract |
| CPU Production Dashboard | Operational system of execution; legacy transition partner; operational projection | Current canonical Production repository is TODO; Pack 6 defines the governed target record | Calendar-led ingestion continues until a governed Booking-to-Production path is reconciled |
| Google Sheets | Mixed configuration, operational projection, audit/log and reporting roles | Must be classified per Sheet; no blanket canonical authority | Retain where needed and prevent layout from defining domain contracts |
| Google Calendar | Provider, operational projection and CPU transition envelope | Not the Booking authority; not established as Production authority | Retain adapter path until replacement is verified |
| Gmail | Provider and legacy source channel | Stable message reference preserves provenance only | Retain authorised adapter use where required |
| Google Drive and generated documents | Provider and document projection store | Quotes, PDFs and files do not replace canonical Booking or Production records | Retain behind document/file adapters |
| Munich RE hot-drinks tools | Client-specific operational reporting | No canonical domain ownership established | Live; retirement not assessed |
| BrightHR workflow | Provider integration; operational system classification TODO | Workforce authority and synchronisation behaviour require manual review | No retirement assessment |
| Square, SumUp and Goodtill work | Provider boundary and planned migration tooling | Canonical till/business ownership TODO | Capability planned; implementation evidence incomplete |
| Events Dashboard | Planned company-wide operational system and projection | Governed Event record owns canonical meaning; the dashboard is the intended shared operational access point, not a separate authority | Not yet implemented |
| Logistics Dashboard | Planned operational system and projection | No canonical Logistics contract or current application exists | Not yet implemented |

No current system is a planned retirement candidate solely because a target boundary now exists. [ADR-010](decisions/ADR-010-legacy-coexistence-and-retirement.md) requires a bounded migration unit, explicit authority direction, scoped equivalence/readiness evidence and separate governed retirement approval.

Current application sharing, active-user attribution, administrative PINs, provider groups and allowlists are implementation or legacy access controls. Under [ADR-008](decisions/ADR-008-identity-and-authmod-enforcement-boundary.md), they do not establish canonical Person, Worker, actor, Assignment or AUTHMOD authority. Exact deployment audiences and migration classifications remain TODO where not confirmed.

```mermaid
flowchart LR
  subgraph Channels["Booking channels"]
    BP["Hospitality Booking Platforms"]
    EMAIL["Legacy booking email and forms"]
  end

  subgraph Authority["Canonical records"]
    BOOKING["Authoritative booking object"]
  end

  subgraph Operations["Operational applications and projections"]
    HD["Hospitality Dashboards"]
    HDS["Hospitality Dashboard Sheets"]
    QUOTE["Quote and PDF generation"]
    CAL["Calendar provider records"]
    CPU["CPU Production Dashboard"]
    CPUS["CPU Orders and Deliveries Sheets"]
  end

  subgraph Adapters["Legacy and transitional adapters"]
    INBOX["Gmail and booking-form parser"]
    CPUP["CPU Calendar and attachment parser"]
  end

  BP --> BOOKING
  BOOKING --> HD
  EMAIL --> INBOX --> HD
  HD --> HDS
  HD --> QUOTE
  HD --> CAL
  CAL --> CPUP --> CPU
  BOOKING -. "preferred attachment where present" .-> CPUP
  CPU --> CPUS
```

The direct platform path is authoritative. The legacy path should normalise into the same Booking domain contract. The current CPU path remains Calendar-led and does not yet consume the canonical Booking-to-Production handoff governed by [ADR-009](decisions/ADR-009-booking-to-production-orchestration.md).

## Hospitality Booking Platforms

| Variant | Confirmed position | Current data relationship |
|---|---|---|
| MNK | Live; preferred consolidation baseline | Creates booking-object JSON directly and projects to its dashboard without a booking-form spreadsheet |
| Angel Court | Live; direct platform preferred | Creates booking objects; legacy email/form path remains a required fallback adapter |
| CFC | Development; built but not operationally deployed | Uses the shared direct booking-object flow |
| Demo | Sales/tender demonstration | Demonstrates the direct booking-object flow; must not define production business rules |

The platform recalculates and validates requests server-side, creates booking IDs, writes operational line-item/request views, and sends notifications. Menu/brochure catalogues and platform settings are current inputs. The authoritative physical repository and mutation/version delivery remain TODO; the applicable Stage 5 schema Packs are part of the completed and committed baseline.

## Legacy inbox adapters

Hospitality Dashboard variants contain Gmail search, message/attachment traversal, spreadsheet conversion, source classification, parsing, duplicate detection, and scan logging. Angel Court must retain this path for tenants who still submit by email. The Line contains distinct form/revision matching behaviour.

These adapters reconstruct fields from message and workbook layout. They are not sources of business truth. Their intended output is a canonical booking with a stable legacy source reference; that canonical transformation is not yet implemented as a shared adapter.

## Hospitality Dashboards

Dashboards review bookings, generate quotes/documents, create Calendar provider records, send confirmations/cancellations, archive files, and maintain operational workflow fields. Their Sheets contain booking projections, quote and Calendar references, statuses, audit information, and variant-specific fields.

The dashboards should consume booking objects rather than reconstruct bookings wherever possible. Under [ADR-007](decisions/ADR-007-projection-and-dashboard-boundary.md), dashboard workflow status is not authoritative commercial Booking status, projected state is advisory at command time, and actions must cross an authorised command boundary. MNK recharge logic and The Line revision behaviour are confirmed variant-specific concerns pending separate domain decisions.

## Quote generation, Drive, Calendar and Sheets

```mermaid
flowchart TB
  BOOKING["Canonical booking intent"] --> DASH["Hospitality Dashboard workflow"]
  DASH --> QUOTE["Quote document and PDF"]
  DASH --> EVENT["Calendar provider record"]
  DASH --> EMAIL["Confirmation or cancellation email"]
  QUOTE --> DRIVE["Drive files and folders"]
  EVENT --> DRIVE
  DASH --> SHEET["Dashboard Sheet projection"]
  EVENT --> CPUADAPTER["CPU Calendar/attachment adapter"]
  CPUADAPTER --> CPUSHEET["CPU Sheet projection"]
```

- **Quote generation:** Dashboard code creates documents/PDFs and stores quote metadata. Pricing policy and template differences remain explicit by variant.
- **Drive:** stores source forms, booking JSON, quotes, PDFs, Calendar attachments, archives, and CPU preparation/allergen evidence. Drive file references are integration metadata, not canonical business identity.
- **Calendar:** dashboards create operational events; CPU currently uses events as its discovery envelope and part of its duplicate/version logic. Calendar is not the canonical booking repository.
- **Sheets:** booking-platform line items/request logs, dashboard data, CPU Orders/Deliveries, settings, and scan logs are current projections, configuration, or audit stores according to their documented role. A Sheet layout must not define a canonical schema.

## CPU production

The CPU scanner reads configured Calendars, prefers a recognised booking JSON attachment, and falls back to quote, booking-form, title, description, location, and owner mappings. It stores a lossy order projection and aggregates production quantities by normalised item display name and site.

CPU statuses (`READY`, `NEEDS_ATTENTION`, `CANCELLED`), preparation state, chef attribution, warnings, detected changes, and photographs are operational/production state. Pack 6 now defines the governed Production Order and Production Line contracts; an authoritative production repository and workflow remain Stage 6 and later delivery work.

## Existing integrations

| Integration | Confirmed current role | Classification |
|---|---|---|
| Gmail | Legacy booking intake and workflow email in Hospitality Dashboards; booking-platform notifications | Legacy adapter and external communication |
| Google Drive | Source/quote/PDF/JSON storage, attachment reading, Office conversion, archives, CPU evidence | External integration and file store |
| Google Calendar | Hospitality Calendar-record creation and CPU discovery/delivery records | Operational integration and transitional adapter envelope; not an ADR-005 event contract |
| Google Sheets | Configuration, projections, logs, reporting and workflow state | Mixed; role must be explicit per Sheet |
| Google Docs/Slides | Quote/document generation and CPU attachment parsing | Document integration/legacy adapter |
| BrightHR | Workforce Operations Platform data workflow | External integration; detailed authority/sync behaviour requires manual review |
| Square, SumUp and Goodtill | Confirmed scope for migration/abstraction capability | Planned/provider boundary; current implementation evidence remains TODO |
| Feedback applications | Multi-site feedback collection/reporting over hospitality data | Shared operational utilities |
| Munich RE hot-drinks tools | Live client-specific tally/reporting with Sheets/Drive data | Client-specific operational reporting |
| Local Codex MCP tooling | In scope | Local tooling; detailed current implementation inventory TODO |

No direct Gmail ingestion or external order API was found in the CPU project.

## Planned Events capability

The Events Dashboard is the planned internal company-wide operational access point for authoritative Event records originating from The Line, FIKA Operational Locations, FIKA Events and Pop-ups, external venues, and email-, phone-, or manually-created Events. The governed Event domain remains canonical. FIKA Events and Pop-ups and The Line will remain separate public/client-facing experiences feeding that shared internal capability.

No Events Dashboard repository, storage, deployment, or confirmed integration implementation was found. Pack 5 now provides the governed Event contract evidence, but the dashboard and its projections remain planned capabilities rather than current-system applications.

```mermaid
flowchart LR
  LINE["The Line public experience"] --> EVENTS["Planned Events Dashboard"]
  SITES["FIKA sites"] --> EVENTS
  POPUPS["FIKA Events and Pop-ups"] --> EVENTS
  EXTERNAL["External venues"] --> EVENTS
  MANUAL["Email, phone and manual events"] --> EVENTS
```

## Planned Logistics capability

Logistics is a planned company-wide capability downstream of hospitality/CPU workflows. No local Logistics Dashboard repository or adopted logistics schema was found. Current CPU delivery Calendar records and the CPU Deliveries Sheet are evidence of an operational delivery concern, but not evidence of the target Logistics design.

## Sources of truth summary

| Concept | Current/declared authority | Non-authoritative representations |
|---|---|---|
| Hospitality booking | Hospitality Booking Platform and its booking object | Dashboard Sheets, line-item/request-log Sheets, Calendar, quote/forms, CPU Orders |
| Booking pricing | Submission-time server-authoritative snapshot in the booking object | Quote/PDF presentation and Sheet projections |
| Menu/catalogue at submission | Site booking-platform catalogue/configuration; governance TODO | Frozen item snapshots in bookings; brochures as documented provenance |
| Dashboard workflow | Dashboard operational projection, pending formal ownership | Booking commercial status must remain separate |
| CPU production work | No canonical production-order repository yet | CPU Orders Sheet is the current operational projection |
| Events | Governed Event record; planned internal Events Dashboard authority | Pack 5 defines the Event contract; channel inventory, architecture, workflows and projections remain Stage 6 work |
| Configuration | Mixed current source files, Settings Sheets and properties | Target central ownership remains future work |

## Transitional adapters and operational projections

Transitional adapters currently include Gmail/form parsers, The Line revision parsing, dashboard booking-object projection adapters, CPU Calendar discovery, CPU quote/form parsing, and Office document conversion. They remain operational until a bounded replacement is verified, accepted and deliberately adopted under ADR-010; coexistence must declare one canonical-write direction and prevent duplicate effects.

Operational projections include booking-platform line-item/request logs, Hospitality Dashboard Sheets, Calendar provider records, quotes/PDFs, CPU Orders, CPU Deliveries, scan logs, and reporting views. Each projection requires a logical owner, declared sources, access purpose, freshness/completeness characteristics, reconciliation rule and retention policy during future implementation work. Projection ownership does not transfer canonical authority.

## Remaining current-state questions

- TODO: Confirm lifecycle, users, owners, criticality, health, and production volumes for applications still marked TODO.
- TODO: Confirm the durable authoritative booking repository and versioned mutation/delivery mechanism.
- TODO: Confirm current production relationships for BrightHR, till providers, reporting, and local MCP tooling beyond inventory evidence.
- TODO: Confirm status ownership and write-back rules for dashboard and CPU corrections.
- TODO: Inventory retention, backup, recovery, release, permission, and observability arrangements.
