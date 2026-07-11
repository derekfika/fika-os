# Service Domain Evidence Audit

## Status and evidence boundary

This report synthesises the existing architecture, domain discovery, location workshops, hospitality/booking/CPU audits and confirmed business examples. It does not inspect production code, adopt policy or create a schema.

## Confirmed evidence

### Wise

- One confirmed location.
- No permanent team and no assumed till relationship.
- Breakfast every Monday and lunch every Friday.
- Approximately 450–500 people per service.
- Delivered equipment, logistics, production and allocated labour are required.

This is strong evidence that Location, Service, Schedule, occurrence, Production, Logistics, Equipment and Workforce are distinct concerns.

### MNK

- Managed location with hospitality booking/dashboard workflows.
- Coffee and grab-and-go operations exist alongside hospitality.
- Direct canonical booking-object flow is the preferred booking pattern.

This is strong evidence that one location can support several services and that Booking is a specific demand record rather than the Service itself.

### Angel Court

- Managed location with hospitality service.
- Direct Booking Platform is preferred.
- Legacy email ingestion remains a fallback adapter into the same canonical booking contract.

This is evidence that ingestion/application variation does not change Service identity.

### The Line

- Venue/location with hospitality and more complex Events activity.
- Public experience remains separate from internal operations.
- Shared Events Dashboard is higher priority than further legacy dashboard development.

This is evidence that Service offering, Event lifecycle, Venue/Location and Application are separate.

### Coffee Cart

- Confirmed reusable pop-up or activation offering.
- May operate at many locations.
- Must not automatically become a Location.

This is strong evidence for Service Template plus deployment occurrence/Event, with Equipment as a separate relationship.

## Findings against the working hypothesis

| Hypothesis | Finding |
|---|---|
| Location is where FIKA operates | Supported, final domain name/cardinality pending. |
| Capability is what a location can support | Supported after removing application/Core/integration entries. |
| Service is what FIKA offers or repeatedly delivers | Strongly supported. |
| Booking is a request or occurrence | Request is supported; recurring occurrence needs a separate concept unless business requires Booking. |
| Event is a qualifying operational lifecycle | Supported as separate domain. |
| Applications/integrations are not capabilities/services | Confirmed by principles and Core boundaries. |

## Candidate Service concepts

| Concept | Evidence | Confidence | Risk if conflated |
|---|---|---|---|
| Service Type | Useful for broad classification/defaults | Medium | Rigid types could hide requirements. |
| Service Template | Coffee Cart and reusable hospitality offers support it | High for Coffee Cart; medium generally | Copying templates into identities creates duplication. |
| Specific Service | Wise Breakfast/Lunch, MNK/Angel Court Hospitality support it | High | Without it, schedule/config is attached directly to Location or Booking. |
| Service Schedule | Wise recurrence strongly supports separation | High | Recurrence flag cannot represent changes/exceptions/history. |
| Service Occurrence | Needed for dated recurring work not clearly a Booking | Medium-high | Automatically creating bookings may invent commercial requests. |
| Booking | Confirmed authoritative customer request | High | Treating it as Service loses reusable offering and recurrence. |
| Event | Confirmed separate future lifecycle | High direction | Treating Service deployment as Event automatically overpopulates Events. |

## Recurrence findings

- Recurrence should be represented by schedules attached to a stable Service, not by a location type or simple recurring flag.
- A Service may have zero, one or several schedules, subject to business approval.
- Schedule changes should normally preserve Service identity.
- Exceptions, holidays, pauses and cancellations belong to schedule/occurrence management, not Location lifecycle.
- Start date and optional end date are strongly recommended but not adopted.
- Wise likely has two Services because breakfast and lunch can plausibly vary independently; the business must confirm commercial/operational identity.
- A recurring schedule should create traceable occurrences; whether it also creates Bookings is unresolved.

## Boundary audit

| Current/discovered concept | Recommended boundary |
|---|---|
| Location identity/type | Location domain/workshop |
| Hospitality/coffee/event support | Operational Capability |
| Breakfast/Lunch/Coffee Cart offering | Service/Template/Type depending level |
| Weekly pattern and exceptions | Service Schedule |
| One customer request | Booking |
| One recurring dated delivery | Provisional Service Occurrence; Booking only by approved rule |
| Qualifying event lifecycle | Event |
| Menu/package/add-on | Separate catalogue relationship |
| Price/contract terms | Commercial/Pricing configuration; frozen in Booking/Quote |
| Production work | Production Order/Line |
| Delivery/movement | Logistics Job |
| Labour assignment | Workforce domain; Service may reference requirement |
| Equipment unit/allocation | Equipment domain; Service may reference requirement |
| Booking platform/dashboard/public UI | Application/AppConfig |
| Calendar/Gmail/Drive/Sheets/provider IDs | Integration metadata/projection |
| Quote/Document/Notification/Feedback | Core workflow/application relationship |
| Reporting | Consumer/derived domain |

## Location-document correction audit

| Current item | Finding | Recommended correction | Confidence |
|---|---|---|---|
| Dashboard capability | It is an application/view, not what the location operationally does. | Move to Application/AppConfig. | High |
| Bookings capability | Booking is a domain/workflow tied to specific Services. | Replace with Service relationship/configuration such as whether bookings are accepted. | High |
| Quotes capability | Quote is a commercial/Core workflow. | Move from operational capability. | High |
| Calendar capability | Calendar is a projection/integration. | Move from operational capability. | High |
| Documents capability | Documents are Core artefacts/workflows. | Move from operational capability. | High |
| Feedback capability | Feedback is workflow/application/reporting relationship. | Move from operational capability unless business defines a real feedback service. | High |
| Notifications capability | Notification is cross-cutting Core. | Move from operational capability. | High |
| Recurring Service Venue type | Recurrence belongs to Service Schedule. | Rename to Client Service Location/Delivered Service Location or remove recurrence wording. | High direction; name open |
| Training capability | Insufficient evidence. | Mark unresolved pending Workforce/Training discovery. | Medium |
| Waste capability | No confirmed domain evidence. | Remove from default catalogue or mark unresolved until owner/problem is identified. | High |
| Location Type defaults | Useful for thirty-second setup but should not dictate truth. | Keep recommended defaults only; explicit effective capabilities/services. | High |
| Till capability | Provider integration choice, not location identity. | Associate with Retail/approved service and provider mapping. | High |

## Example provisional models

1. **Wise Monday Breakfast:** Location + Specific Recurring Breakfast Service + Monday Schedule + dated Occurrences + Production/Logistics/Equipment/Labour requirements.
2. **Wise Friday Lunch:** same pattern with separate candidate Service identity.
3. **MNK Hospitality:** Location + Hospitality Service + customer Bookings + downstream Production/Logistics when needed.
4. **MNK Coffee Bar:** Location + ongoing Coffee Service; Bookings not assumed.
5. **Angel Court Hospitality:** Location + Hospitality Service + direct and legacy Booking ingestion paths.
6. **The Line Events:** Location/Venue + Event Service offer + separate qualifying Events + public/internal applications.
7. **Coffee Cart Pop-up:** reusable Service Template + Equipment relationship + deployment occurrence or Event at a Location.
8. **One-off external corporate event:** Event at external venue; selected Service offer; Location record only if persistence threshold is met.

## Blocking business decisions

- Service definition and whether internal services are included.
- Service Type/Template/Specific Service naming and ownership.
- Service-to-Client and Service-to-Location cardinality.
- Wise one-versus-two Service decision.
- Schedule and occurrence lifecycle, exceptions and pause rules.
- When occurrence creates Booking.
- Event qualification and Coffee Cart deployment treatment.
- Menu/package/pricing/contract ownership.
- Production source and requirement defaults versus occurrence overrides.
- Labour/equipment/logistics requirement ownership.
- Approval of corrections to the Location documents.

## Questions routed to other owners

- **Operations:** Wise identity, schedules, exceptions, attendance and service lifecycle.
- **Events:** Event qualification, The Line service/Events relationship, Coffee Cart deployment and venue threshold.
- **CPU/Production:** production inputs/source, occurrence changes and requirement overrides.
- **Finance/Commercial:** client/service ownership, bookings for recurring work, price/contract and catalogue ownership.
- **Marketing/Brand:** names, descriptions, brand variants and seasonal identity.
- **Workforce/HR:** labour requirements versus assignments, Training boundary and privacy.

## Audit conclusion

Evidence is sufficient for the pre-filled Service decision workshop. It is not sufficient for a schema or final policy. The next safe step is to run `service-domain-workshop.md`, record owner decisions, then create a Service Business Decision Record that explicitly approves vocabulary, identity, recurrence, occurrence/booking and boundary corrections.
