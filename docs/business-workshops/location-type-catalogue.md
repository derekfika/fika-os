# Candidate Location Type Catalogue

> **Classification: Historical discovery evidence.** Candidate types and open questions are retained for context. Approved Operational Location type decisions supersede conflicting proposals.

## Purpose

This catalogue asks whether locations should be classified and what useful defaults each classification might provide. Types do not create identity and do not automatically grant capabilities, permissions or provider relationships.

All entries are candidates for workshop decision, not adopted types.

## Type model questions

| Question | Pre-filled evidence | Owner | Status | Final answer |
|---|---|---|---|---|
| Should every location have a type? | Thirty-second creation benefits from a recommended starting configuration. | Derek / Operations | Open |  |
| Should a location have one primary type or several? | The Line may combine hospitality and event-venue characteristics. | Derek / Domain owners | Open |  |
| Can type change over time? | Planned locations may become active managed sites; pop-ups may become recurring. | Derek / Operations | Open |  |
| Do types supply defaults only? | Independent capabilities and genuine overrides are required. | Derek / Platform | Recommended, not decided |  |
| Who owns the type catalogue? | No owner is confirmed. | Derek | Open |  |

## Candidate types

| Type | Purpose | Typical examples | Temporary or permanent | Typical applications | Typical workflows | Typical users | Typical integrations | Recommended default capabilities | Business owner | Open questions |
|---|---|---|---|---|---|---|---|---|---|---|
| Standard Managed Site | A location with broad ongoing FIKA operational responsibility | MNK and Angel Court are proposed examples | Usually permanent/ongoing | Booking, hospitality operations, reporting; exact set varies | Booking-to-service, quotes, documents, production hand-off, reporting | Site operations, hospitality users, managers | Calendar, email, files and Sheets are current examples; till remains optional | Hospitality, Bookings, Dashboard, Quotes, Documents, Reporting; others by decision | Derek / Operations: TODO | What minimum responsibilities distinguish it from a recurring service venue? |
| Event Venue | A venue repeatedly recognised for event planning or delivery | The Line is a contrasting candidate; external venues may remain Event-only | Permanent or recurring; event use may be temporary | Events Dashboard and relevant public/client experience | Enquiry, qualification, quote, event delivery, equipment/logistics planning | Events team, venue contacts, operations | Calendar, documents, media and optional provider integrations | Events, Quotes, Calendar, Documents, Media, Notifications, Reporting | Events owner: TODO | When does a one-off venue become a canonical location? |
| Recurring Service Venue | A durable context where FIKA delivers scheduled recurring services without full managed-site assumptions | Wise | Ongoing arrangement, potentially time-limited contract | Possibly none dedicated; operational planning/reporting views | Recurring service scheduling, production, logistics and reporting | Operations, CPU/logistics users, client contacts | Calendar/files optional; till not assumed | Reporting plus selected Production/Logistics and service capabilities | Derek / Operations: TODO | Is “venue” right when the context is a client service rather than controlled premises? |
| Pop-up | A temporary operating context with repeated configuration or reporting needs | Temporary FIKA pop-up | Temporary | Event/public experience and internal operations as needed | Mobilise, open, operate, close, reconcile | Events/pop-up team, temporary operators | Optional payments, calendar, documents, media and logistics | Events, Mobilisation, Documents, Media, Reporting; others optional | Events/Pop-up owner: TODO | Minimum duration/reuse threshold? Does every pop-up need a canonical location? |
| Production Kitchen | A location whose primary role is preparation/production | CPU kitchen is a conceptual example; exact canonical location not confirmed | Usually permanent/ongoing | Production operations and logistics views | Production planning, preparation, handover and dispatch | Production team, managers, logistics users | Calendar/files may remain projections; equipment integrations future | Production, Logistics, Equipment, Workforce, Reporting | Production owner: TODO | Can it be a secondary type of a managed site? |
| Training Centre | A location primarily used for organised training | No confirmed example | Permanent or recurring | Future training/workforce application | Schedule training, assign attendees/resources, record completion | Trainers, workforce users, attendees | Calendar, documents, notifications optional | Training, Calendar, Documents, Notifications, Reporting | Workforce/Training owner: TODO | Is Training a domain, capability or workflow? |
| Office | A primarily administrative workplace | No confirmed example in current discovery | Usually permanent | Workforce, equipment, reporting | Workforce planning, equipment allocation, administration | Office staff, managers | Workforce/calendar/files optional | Workforce, Equipment, Reporting | Operations/Workforce owner: TODO | Is an office relevant to the operational-location domain if no service is delivered? |
| Warehouse | A storage/dispatch context | No confirmed example | Usually permanent/ongoing | Equipment/logistics operations | Receive, store, allocate, pick, dispatch, return | Logistics/equipment users | Provider integrations optional | Logistics, Equipment, Workforce, Reporting | Logistics owner: TODO | Separate inventory domain required? |
| Planned Location | A pre-opening context used for mobilisation and configuration | CFC may be a contrasting Development example; final classification TODO | Temporary lifecycle phase, not necessarily a durable type | Mobilisation and configuration administration | Plan, approve, configure, validate readiness, open | Mobilisation team, domain owners | Integrations should be inactive until approved | Mobilisation; other capabilities planned but inactive | Derek / Mobilisation owner | Should “planned” be lifecycle rather than type? Recommended: lifecycle. |

## Contrasting examples

- **MNK:** proposed Standard Managed Site with broad hospitality applications.
- **Angel Court:** proposed Standard Managed Site with direct booking and retained legacy ingestion.
- **Wise:** proposed Recurring Service Venue; recurring services matter even without a till or dedicated app.
- **The Line:** may be Event Venue, Standard Managed Site or a multi-classified location; this is a deliberate test of the type model.

## Recommendation for workshop

Use one **primary operating type** for initial defaults and allow explicit secondary descriptors only if they answer a real business need. Treat `planned`, `active`, `paused`, `closed` and `legacy` as lifecycle rather than types. Type defaults should be recommendations; the effective capability set remains explicit and auditable.

This recommendation requires business approval.
