# Candidate Location Capability Model

> **Classification: Historical discovery evidence.** Candidate capabilities and open questions are retained for context. Approved Operational Capability decisions govern current meaning and ownership.

## Purpose

Capabilities describe what a location is enabled to do. They are independent from canonical identity and should not be inferred solely from location type, application folders or provider mappings.

This is a workshop catalogue, not a schema or implementation design.

## Core decisions

| Question | Pre-filled evidence | Owner | Status | Final answer |
|---|---|---|---|---|
| Should every capability be optional? | Wise shows that not every location needs the same systems or a till. Some capabilities may require dependencies. | Derek / Domain owners | Open |  |
| Should types provide recommended defaults? | Approximately thirty-second setup requires sensible starting selections. | Derek / Operations | Recommended, not decided |  |
| Can users override defaults? | Real variants have genuine differences. Uncontrolled overrides risk duplication. | Derek / Domain owners | Open |  |
| Who may approve an override? | Configuration ownership is currently fragmented. | Derek | Open |  |
| Should capabilities determine applications? | Applications should consume domains; capability selection may enable relevant experiences but must not define business meaning. | Platform / Domain owners | Open |  |
| Should capabilities determine configuration? | Each capability may require validated configuration, with defaults and explicit missing-state handling. | Platform / Domain owners | Open |  |
| Should capabilities determine workflows? | Capabilities should make approved workflows available; lifecycle and permissions remain domain-owned. | Domain owners | Open |  |
| Should capabilities determine permissions? | Capability enables a permission vocabulary but does not grant users access automatically. | Security / Domain owners | Open |  |
| Should capabilities determine reporting? | Enabled capabilities may publish authorised reporting views; Reporting does not own source data. | Reporting / Domain owners | Open |  |
| Should capabilities determine integrations? | They may permit or require an integration category, but each provider relationship remains optional unless explicitly required. | Platform / Domain owners | Open |  |

## Candidate capability catalogue

| Capability | Plain-English purpose | Default optionality | Possible dependencies | May enable | Owner | Evidence / open question |
|---|---|---|---|---|---|---|
| Hospitality | Deliver hospitality services | Optional | Service configuration | Hospitality workflows and views | Hospitality owner: TODO | Confirm whether this is parent capability for bookings/quotes. |
| Coffee | Operate coffee/hot-drinks service | Optional | Service/menu configuration | Tally, operations and reporting | Coffee owner: TODO | Munich RE confirms operational relevance. |
| Retail | Operate retail activity | Optional | Commercial/catalogue configuration | Retail applications/reporting | Retail owner: TODO | Current detailed evidence missing. |
| Till | Use a till-provider integration | Optional | Retail or other approved need | Provider adapter and till reporting | Retail/Finance owner: TODO | Never required for canonical location; provider remains separate. |
| Production | Produce/prepare operational demand | Optional | Service/production configuration | Production orders/views | Production owner: TODO | Distinguish production source from demand destination. |
| Logistics | Plan or execute movements | Optional | Production/Event demand and service locations | Logistics jobs/views | Logistics owner: TODO | Planned domain. |
| Equipment | Manage/allocate equipment | Optional | Equipment domain | Equipment workflows/views | Equipment owner: TODO | Future domain. |
| Workforce | Plan/assign workforce | Optional | User/workforce policy | Workforce planning views | Workforce owner: TODO | Privacy and provider authority unresolved. |
| Bookings | Accept/manage hospitality bookings | Optional | Hospitality, validation, pricing | Booking platform/workflows | Booking owner: TODO | Direct platform authority confirmed. |
| Dashboard | Provide an operational application view | Optional presentation capability | Underlying domain capabilities | Authorised operational views | Application owner: TODO | Consider whether “Dashboard” is an application choice, not a business capability. |
| Quotes | Create/manage quotes | Optional | Booking/Event and pricing | Quote workflow/documents | Commercial owner: TODO | Separate quote domain boundary proposed. |
| Calendar | Synchronise schedules | Optional | A schedule-owning domain | Calendar projections | Domain/Application owner: TODO | Provider-neutral projection capability. |
| Documents | Generate/manage artefacts | Optional | Source domain, Brand | Quotes, PDFs, brochures | Document owner: TODO | Existing generation evidence. |
| Media | Manage approved assets | Optional | Rights/brand policy | Media Portal/assets | Media owner: TODO | Future domain. |
| Reporting | Provide governed insight | Optional, likely common | Source capabilities and permissions | Operational/client reports | Reporting owner: TODO | Existing fragmented reporting. |
| Waste | Track waste | Optional | Operational process and reporting | Waste workflows/reporting | Waste owner: TODO | No confirmed domain evidence yet. |
| Training | Coordinate training | Optional | Workforce/Calendar/Documents | Training workflows | Training owner: TODO | Domain boundary unresolved. |
| Mobilisation | Coordinate opening/transition | Optional or lifecycle-triggered | Planned location and domain owners | Readiness workflow | Mobilisation owner: TODO | Future domain. |
| Events | Manage events | Optional | Client/location/venue context | Events applications/workflows | Events owner: TODO | Confirmed planned priority. |
| Feedback | Collect/report hospitality feedback | Optional | Hospitality/Bookings/Reporting | Feedback applications | Hospitality/Reporting owner: TODO | Existing shared utilities. |
| Notifications | Send governed operational/client messages | Supporting capability | Source workflows, preferences, Brand | Email/dashboard/future channels | Notification owner: TODO | Generation separate from delivery. |

## Default and override model

Proposed workshop model:

```text
Choose Location Type
  -> receive recommended capability set
  -> review required dependencies and missing decisions
  -> approve explicit additions/removals
  -> record effective capability set and override reason
```

Rules to decide:

- A type default is not a permanent grant.
- Effective capabilities are explicit and versioned.
- Dependency rules prevent invalid combinations.
- An application is enabled only when the underlying business capability and permissions exist.
- A provider integration is selected separately from the capability it supports.
- Removing a capability requires impact, retention and historical-access review.
- Planned capabilities may be selected without becoming active until readiness approval.

## Example default sets for discussion

| Proposed type | Recommended starting capabilities | Explicitly not assumed |
|---|---|---|
| Standard Managed Site | Hospitality, Bookings, Dashboard, Quotes, Documents, Reporting, Feedback | Till, Retail, Coffee, Production, Logistics, Events |
| Event Venue | Events, Quotes, Calendar, Documents, Media, Notifications, Reporting | Till, permanent Workforce, Hospitality booking |
| Recurring Service Venue | Reporting plus selected Production/Logistics and recurring-service support | Till, Dashboard, permanent staff |
| Pop-up | Events, Mobilisation, Documents, Media, Reporting | Till and Retail unless selected; permanent staff |
| Production Kitchen | Production, Logistics, Equipment, Workforce, Reporting | Bookings, Till, public experience |
| Training Centre | Training, Calendar, Documents, Notifications, Reporting | Till, Hospitality, Production |
| Office | Workforce, Equipment, Reporting | Till, Bookings, Production |
| Warehouse | Logistics, Equipment, Workforce, Reporting | Till, Bookings, Hospitality |

Every default above is provisional.

## Business outcome

The capability decision is complete when the business approves:

- the initial catalogue and owner for each capability;
- optional, required or dependency-driven behaviour;
- type defaults;
- override authority and audit;
- how capabilities enable applications, configuration, workflows, permissions, reporting and integrations;
- activation, suspension and retirement rules.
