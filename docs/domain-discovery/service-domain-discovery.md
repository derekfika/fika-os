# Service Domain Discovery

> **Classification: Supporting discovery evidence.** Canonical Service Arrangement, Recurring Schedule and Service Occurrence meaning now comes from approved decisions and the [Platform Domain Map](../platform-domain-map.md).

## Status and purpose

This is read-only business/domain discovery. It proposes vocabulary and boundaries for workshop review; it does not adopt names, policies, schemas or implementation.

## A. Plain-English definition

### Proposed staff-friendly definition

> A Service describes a defined offering or piece of work that FIKA provides at, from, or through a location.

This statement is a sound starting point but needs two clarifications:

1. a Service should be durable enough to reuse or manage over time, rather than being one dated occurrence;
2. a Service may be location-specific or based on a reusable template that can be offered in several places.

### Working domain definition

A **Service** is a defined FIKA offering or operating arrangement with a stable business identity, an owner, an availability/lifecycle, operational requirements and relationships to clients and locations. It may be ad hoc, recurring, temporary or seasonal. It does not itself represent one customer request, one event, one production order or one delivery.

This definition remains provisional.

## Evidence test of the working hypothesis

| Hypothesis statement | Evidence assessment | Recommendation |
|---|---|---|
| A Location represents where FIKA operates | Supported by operational-location discovery, subject to final naming/cardinality. | Retain as working boundary. |
| An Operational Capability describes what a location can support | Useful distinction, but the current capability list includes applications and Core workflows that should be removed. | Retain after catalogue correction. |
| A Service describes what FIKA actually offers or repeatedly delivers | Strongly supported by Wise, MNK hospitality/coffee, Angel Court hospitality and Coffee Cart. | Retain as Service-domain basis. |
| A Booking is a specific customer request or scheduled occurrence | Supported for specific customer requests. Automatic recurring occurrences should not automatically be called bookings without business approval. | Separate Booking from provisional `Service Occurrence`. |
| An Event is the operational lifecycle of a qualifying event | Supported by target Events direction. | Retain; define qualification in Events discovery. |
| Applications/integrations are not capabilities or services | Supported by platform principles and Core boundaries. | Correct the location capability catalogue accordingly. |

## Recommended conceptual layers

```text
Service Type
  -> broad business classification

Service Template
  -> reusable blueprint, optional

Specific Service
  -> configured offering or operating arrangement
  -> relates to client and/or location
  -> may have one or more Service Schedules

Service Schedule
  -> recurrence, validity and exceptions
  -> produces or organises Service Occurrences

Booking
  -> a specific customer request for a service

Event
  -> a separate qualifying event lifecycle

Production Order / Logistics Job
  -> downstream operational work
```

These are conceptual distinctions, not adopted object names.

## B. Service versus capability

A **capability** answers: “What can this location support?” A **service** answers: “What does FIKA actually offer or deliver here?”

Example:

- Hospitality capability means the location can support hospitality operations.
- Breakfast, Lunch, Canapés or Meeting Hospitality may be distinct services offered at that location.
- Booking, quote, document and notification workflows may support those services but are not themselves location capabilities.

This distinction is useful and evidence-based because:

- MNK can support hospitality, coffee and grab-and-go as different services at one managed location;
- Wise delivers specific recurring breakfast and lunch services without needing every managed-site capability;
- Coffee Cart is a reusable service offering that can operate at many locations;
- a location may be capable of events without every activity becoming an Event Service or qualifying Event;
- capabilities can exist before a specific service is activated.

Capability should not be inferred from an installed application or provider connection. Service should not be inferred merely because a capability is enabled.

## C. Service versus booking

- The **Service** defines the reusable/configured offering or operating arrangement.
- A **Booking** records a particular customer request against a service, with its own identity, commercial status, requested items/timing and frozen pricing.
- A **Service Schedule** defines recurrence and exceptions for a recurring service.
- A provisional **Service Occurrence** represents one dated delivery of a scheduled service when no customer request exists or when the operational occurrence must be tracked independently.
- An occurrence may create Production and Logistics work without becoming a Booking automatically.

Recurring operational work should generate or organise dated occurrences. Whether those occurrences should also create bookings depends on commercial/accounting/workflow needs and is a blocking business decision.

## D. Service archetypes

All archetypes are provisional.

| Archetype | Purpose | Example | Location relationship | Customer relationship | Recurring/ad hoc | Booking requirement | Production | Logistics | Labour | Pricing model | Menu/package relationship | Business owner | Open questions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hospitality Service | Offer hospitality food/drink service | MNK or Angel Court Hospitality | Usually assigned to one managed location; templates may be reusable | Client/location and booking customer roles both possible | Often ad hoc bookings; may also recur | Usually yes for customer requests | Often | Sometimes | Sometimes | Catalogue/items, fees and charges | Menu/catalogue and packages | Hospitality owner: TODO | Is Hospitality a type with Breakfast/Lunch subtypes or a broader family? |
| Coffee Service | Provide ongoing coffee operation | MNK Coffee Bar | One location in confirmed example | Likely location/client relationship; details TODO | Ongoing/recurring | Not necessarily | Possibly local preparation | Usually limited/none | Usually | Retail/contract/pricing model TODO | Coffee menu/products | Coffee owner: TODO | Are coffee bar and hot-drinks reporting the same service family? |
| Retail Service | Sell products directly | MNK grab-and-go is confirmed context | Usually location-assigned | End customer/client relationships TODO | Ongoing | No hospitality booking assumed | Replenishment rather than booking production | Supplier/logistics may apply | Usually | Retail prices/tax | Product catalogue | Retail owner: TODO | Separate domain from Service? Current evidence limited. |
| Recurring Breakfast Service | Deliver breakfast on a repeating pattern | Wise Monday Breakfast | Assigned to Wise location | Client relationship to Wise | Recurring | Decision required | Yes | Yes | Yes | Contract/recurring commercial arrangement TODO | Breakfast menu/package | Operations/Commercial | Does each Monday create an occurrence, booking or both? |
| Recurring Lunch Service | Deliver lunch on a repeating pattern | Wise Friday Lunch | Assigned to Wise location | Client relationship to Wise | Recurring | Decision required | Yes | Yes | Yes | Contract/recurring commercial arrangement TODO | Lunch menu/package | Operations/Commercial | Same identity as breakfast or separate service? |
| Event Service | Offer event-related work | The Line Events | May be tied to venue/location or reusable across venues | Client/customer relationship per event | Usually ad hoc; programme may recur | Booking relationship TODO | Often | Often | Often | Quote/event costing | Event packages/add-ons | Events owner: TODO | Service offer versus qualifying Event boundary? |
| Pop-up Service | Deliver a temporary/pop-up offering | FIKA pop-up | Can deploy at many locations | Client/event relationship varies | Temporary/ad hoc/seasonal | Optional/decision | Often | Often | Often | Package/quote/retail possibilities | Pop-up packages/add-ons | Events/Pop-up owner: TODO | When is deployment an Event versus occurrence? |
| Coffee Cart Activation | Reusable mobile activation offering | Coffee Cart | Reusable across locations; cart is not automatically a location | Client/event relationship per deployment | Ad hoc, seasonal or recurring | Optional/decision | Preparation may apply | Yes | Yes | Package/day/rate model TODO | Cart package/menu | Events/Coffee owner: TODO | Is the cart Equipment plus Service Template? How is availability allocated? |
| Production Service | Provide production internally or commercially | CPU production as possible internal service | From a production location to demand locations | Internal/client relationship unclear | Ongoing | No direct booking required | It is the production domain | Handover/logistics | Yes | Internal allocation or commercial pricing TODO | Production catalogue/conversion | Production owner: TODO | Is this truly a Service or only a downstream domain capability? |
| Training Service | Deliver organised training | No confirmed example | May be offered at one or many locations | Internal/client participant relationship TODO | Ad hoc or recurring | Registration/booking concept TODO | No food production assumed | Equipment/travel possible | Trainers required | Rate/contract/internal | Training programme/materials | Workforce/Training owner: TODO | Service, workflow or future domain? |
| Delivered-in Catering Service | Supply prepared catering into a client venue | Wise is a strong candidate | Produced elsewhere, delivered to the assigned location | Client relationship | Recurring or ad hoc | Decision required | Yes, offsite/source TODO | Yes | Delivery/service labour | Contract/package/pricing | Menu/package | Operations/Commercial | Is this a type, fulfilment method or service family? |

## E. Recurrence and scheduling

### Recommendation for workshop

Recurrence should not be a fixed property such as `weekly = true`. A specific Service should have zero, one or more **Service Schedules**. The schedule owns recurrence pattern, time window, validity and exceptions. Service identity remains stable when a schedule changes.

Candidate schedule concerns:

- start date and optional end date;
- day/date pattern and local time zone;
- service window or required time semantics;
- expected attendance/covers and forecast ownership;
- temporary pauses;
- holiday/exception dates;
- cancelled or replacement occurrences;
- effective version/history;
- production, logistics and labour lead times.

### Wise test

The current evidence favours **two specific services**—Wise Monday Breakfast and Wise Friday Lunch—because they differ in offering, day and likely menu/production requirements. Each would normally have one schedule. A single “Wise Catering” service with two schedules remains possible if the business considers breakfast/lunch one commercial/operational identity.

The decision should use identity tests:

- Can one be paused, repriced or ended without changing the other?
- Do they have separate menus/packages, owners or operational requirements?
- Are they reported and contracted separately?
- Would changing Friday Lunch to Thursday still be the same service?

Likely answer to the last question: yes, if the Lunch offering/arrangement remains the same and only its schedule changes.

## F. Location relationships

- One location can offer many services: MNK Hospitality and MNK Coffee Bar support this.
- A reusable Service Template can be used across many locations: Coffee Cart supports this.
- A specific Service may be assigned to one location or to several locations if the business wants one identity across them; cardinality requires decision.
- A service may exist before its first location when it is a template or approved planned offering.
- A location-specific service may move only if its identity is defined independently from location; otherwise a new service assignment may be clearer.
- Each Coffee Cart deployment should create a Service Occurrence or Event; create a Booking when a specific customer request/commercial booking is required. It should not automatically create a new Service or Location.

## G. Client and commercial relationships

Recommended distinctions:

- A Service Template may be reusable across clients.
- A Specific Service may relate to a client, a location, or both.
- Pricing belongs to commercial/pricing configuration referenced by the service and frozen in each Booking/Quote where applicable.
- Menus and packages are separate catalogues/offerings referenced by the service.
- Contract terms are separate commercial configuration or a future contract relationship, not free-form service identity.
- A service can be paused without closing its location.
- Service owner, commercial owner and operational owner may be different roles.

Exact ownership and cardinality require Commercial/Finance decisions.

## H. Operational requirements

A Service should declare or reference requirements, not hardcode application assumptions.

| Requirement | Service relationship | Boundary |
|---|---|---|
| Bookings | Optional relationship | Booking records specific customer requests. |
| Recurring schedules | Optional child/relationship | Schedule owns recurrence and exceptions. |
| Labour | Requirement/policy | Workforce owns people/assignments. |
| Production | Requirement/fulfilment relationship | Production owns orders/lines/status. |
| Logistics | Requirement/fulfilment relationship | Logistics owns jobs/routes/outcomes. |
| Equipment | Requirement/allocated relationship | Equipment owns inventory/condition/allocation. |
| Menus/packages | Catalogue relationship | Menu/package owns offer structure/content. |
| Pricing | Commercial configuration relationship | Booking/Quote freezes agreed snapshot. |
| Suppliers | Provider/Supplier relationship | Supplier identity/accounts are separate. |
| Documents | Core workflow relationship | Documents own generated artefacts. |
| Calendar events | Projection/integration relationship | Calendar is not service identity or schedule authority. |
| Reporting | Consumer relationship | Reporting owns definitions, not source facts. |
| Notifications | Core workflow relationship | Generated from service/booking/event/occurrence intent. |
| Feedback | Workflow/reporting relationship | Feedback application is not a capability or service. |
| Waste tracking | Possible future relationship | Domain/capability status unresolved. |

## I. Real examples

All rows are provisional models.

| Example | Location | Operational capabilities | Proposed service | Schedule/recurrence | Booking | Event | Production | Logistics | Labour | Applications | Integrations | Open decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Wise Monday Breakfast | Wise | Delivered catering, production/logistics support | Recurring Breakfast Service | Mondays; start/end/exceptions TODO | Decision: occurrence versus booking | No qualifying Event assumed | Required | Required | Allocated labour required | No dedicated app confirmed | Optional; no till assumed | Separate service? occurrence creation, times, menu, commercial owner |
| Wise Friday Lunch | Wise | Delivered catering, production/logistics support | Recurring Lunch Service | Fridays; start/end/exceptions TODO | Decision: occurrence versus booking | No qualifying Event assumed | Required | Required | Allocated labour required | No dedicated app confirmed | Optional; no till assumed | Same identity questions as Breakfast |
| MNK Hospitality | MNK | Hospitality | Location-specific Hospitality Service | Availability/booking slots; recurrence not established | Direct canonical booking path | Not automatically Event | Downstream CPU | Logistics when required | Service labour as required | Booking platform, dashboard, client portal | Calendar, Gmail, Drive, Sheets; others optional | Service catalogue/type and ownership |
| MNK Coffee Bar | MNK | Coffee, possibly retail/grab-and-go | Ongoing Coffee Service | Operating pattern TODO | No hospitality booking assumed | No | Production/replenishment boundary TODO | Supplier/replenishment TODO | Permanent/rota status TODO | Existing app coverage TODO | Till/provider not assumed | Coffee versus Retail services and pricing owner |
| Angel Court Hospitality | Angel Court | Hospitality | Location-specific Hospitality Service | Availability/booking pattern | Direct bookings plus legacy adapter | Not automatically Event | Downstream CPU | When required | Service labour as required | Booking platform and dashboard | Calendar, Gmail, Drive, Sheets; providers optional | Legacy recurrence/booking boundary and service owner |
| The Line Events | The Line | Events plus hospitality support | Event Service/venue offer | Ad hoc and programme recurrence TODO | Booking relationship TODO | Each qualifying activity becomes Event | Often | Often | Often | Future public experience and Events Dashboard; legacy dashboard lower priority | Calendar/documents/media and optional providers | Service versus Event lifecycle; venue packages; ownership |
| Coffee Cart Pop-up | Assigned deployment location | Events/pop-up, coffee, equipment/logistics | Reusable Coffee Cart Activation template; deployment-specific occurrence | Ad hoc/seasonal or repeated | If customer request/commercial booking requires | Event if qualifying | Preparation may apply | Required | Required | Future Events/pop-up experiences | Optional payments/calendar/documents | Cart as equipment, service template ownership, occurrence/Event rule |
| One-off external corporate event | External venue reference; canonical location only if threshold met | Events and required fulfilment capabilities | Event-related service selected for one engagement | One dated occurrence | Booking/quote relationship TODO | Yes, qualifying Event | As required | As required | As required | Future Events Dashboard/public/manual channel | Optional by event | Venue promotion threshold and commercial workflow |

## J. Domain boundaries

| Concept | Classification | Recommendation |
|---|---|---|
| Hospitality, Coffee, Retail, Event, Training | Service Type candidates | Broad classification only; catalogue provisional. |
| Wise Monday Breakfast | Specific Service candidate | One configured recurring offering/arrangement. |
| Coffee Cart Activation | Service Template candidate | Reusable across locations; specific deployments are occurrences/events. |
| Weekly Monday pattern | Service Schedule | Separate from Service identity. |
| One dated Monday delivery | Unresolved: Service Occurrence | Do not automatically classify as Booking. |
| Specific customer hospitality request | Booking | Canonical commercial/service request. |
| Qualifying event lifecycle | Event | Separate from Service offer/template. |
| Wise/MNK/Angel Court/The Line | Location | Durable context, final domain name pending. |
| Hospitality/coffee/event support | Capability | What the location can support, not what is delivered. |
| Menu, package, add-on | Menu or Package | Referenced by service; separate ownership/versioning. |
| Service price policy/contract rates | Pricing Configuration | Booking/Quote freezes a versioned commercial snapshot. |
| CPU order/line | Production | Downstream work derived from booking/occurrence/event. |
| Delivery/collection/route | Logistics | Downstream work. |
| Booking platform/dashboard/public experience | AppConfig/Application | Consumer of domains, not Service or capability. |
| Provider IDs/calendar/file references | Integration Metadata | Optional adapter data. |
| Calendar event/dashboard row/report | Operational Projection | Not canonical service identity or schedule. |
| Contract, supplier, waste and training ownership | Unresolved/separate future domain | Requires focused discovery. |

## K. Recommended corrections to location documents

Do not apply these automatically; route them to the Location workshop:

1. Move **Dashboard** from operational capability to Application/experience.
2. Treat **Bookings** as a Booking-domain/workflow relationship; a location may expose an “accepts bookings” configuration derived from enabled services.
3. Move **Quotes, Calendar, Documents, Feedback and Notifications** to Core workflows/applications/integration relationships rather than location operational capabilities.
4. Rename or remove **Recurring Service Venue** because recurrence belongs to Service Schedule. Candidate replacement: `Client Service Location` or `Delivered Service Location`; final type requires workshop decision.
5. Keep **Location Type** as a source of recommended defaults only. Effective capabilities and services remain explicit.
6. Keep **Training** unresolved until deciding whether it is a service family, workforce workflow or domain.
7. Keep **Waste** unresolved until business ownership/problem evidence exists; do not assume it is a capability.
8. Separate **Production** and **Logistics** domain relationships from the location's capability to support them.
9. Treat **Till** as optional provider/integration enablement supporting Retail or another service, not an operational identity.

## Blocking questions before a Service decision record

- What gives a Specific Service stable identity across schedule, menu, price, client or location changes?
- Does Service cover customer-facing offerings only, or internal services such as CPU production?
- Does a Specific Service belong to one location, one client, both, or many?
- Are Wise Breakfast and Lunch two Services or one Service with two schedules?
- When does a recurring schedule create a Booking versus a non-booking Service Occurrence?
- What qualifies a Service deployment as an Event?
- Is Coffee Cart primarily a Service Template, Equipment asset, or combined relationship?
- Who owns Service Type, Service Template, Specific Service, schedule, pricing, menu and operational requirements?
- What lifecycle states apply independently to Service and Schedule?
- Which corrections to the Location capability/type catalogues are approved?

## Discovery conclusion

There is enough evidence for a Service decision workshop. There is not enough evidence to adopt the definition, recurrence model or catalogue, and no schema should be created. The next step is the owner-routed workshop in `docs/business-workshops/service-domain-workshop.md`, followed by a Service Business Decision Record only after blocking questions are resolved.
