# Provisional Service Type Catalogue

## Purpose

This catalogue distinguishes classification, reusable blueprint, configured service, schedule and dated demand. It is not an adopted taxonomy or schema.

## Concept levels

| Level | Plain-English meaning | Example | Owns | Does not own | Status |
|---|---|---|---|---|---|
| Service Type | Broad classification used for language, policy defaults and reporting | Hospitality Service, Coffee Service | Classification and recommended defaults | Specific client/location settings or dates | Provisional |
| Service Template | Reusable blueprint that can be configured in several places | Coffee Cart Activation, Meeting Hospitality template | Reusable description, standard requirements and catalogue references | A live location assignment or occurrence | Provisional |
| Specific Service | A defined offering/operating arrangement for a client/location context | MNK Hospitality, Wise Monday Breakfast | Stable service identity, lifecycle, relationships and requirements | Individual request, event, production or delivery state | Provisional |
| Service Schedule | Recurrence/availability attached to a Specific Service | Mondays during an effective period | Pattern, validity, times, exceptions and pause | Service identity or dated fulfilment outcome | Provisional |
| Booking or Occurrence | One dated request or delivery instance | One hospitality booking; one Wise Monday delivery | Booking owns customer request; occurrence ownership remains TODO | Reusable service definition | Split decision required |

## Candidate service types

| Service Type | Purpose | Candidate specific services/templates | Typical location relationship | Typical demand | Common operational requirements | Owner | Open questions |
|---|---|---|---|---|---|---|---|
| Hospitality Service | Provide ordered hospitality food/drink | MNK Hospitality, Angel Court Hospitality, Breakfast/Lunch/Canapés/Meeting Hospitality | Usually assigned to managed location; templates reusable | Mostly bookings; recurrence possible | Menu, pricing, production, labour, documents, logistics | Hospitality owner: TODO | One type or several subtypes? |
| Coffee Service | Operate coffee/hot-drinks offering | MNK Coffee Bar; Munich RE-related service relationship TODO | Usually location-specific; mobile template possible | Ongoing operations rather than bookings | Menu/products, workforce, reporting, supplies | Coffee owner: TODO | Coffee versus Retail boundary? |
| Retail Service | Sell products directly | MNK grab-and-go candidate | Usually location-specific | Transactions/replenishment; not hospitality booking | Catalogue, pricing, suppliers, reporting | Retail owner: TODO | Is Retail its own domain? |
| Recurring Catering Service | Deliver prepared food on a repeating pattern | Wise Monday Breakfast, Wise Friday Lunch | Assigned to client/location; produced elsewhere may apply | Service Occurrences; Booking decision open | Production, logistics, labour, menu/package, forecast | Operations/Commercial | Is recurrence a type or only schedule? Recommendation: schedule. |
| Event Service | Offer event planning/delivery or venue event services | The Line Events, external corporate event offer | Location/venue-specific or reusable | Qualifying Events; booking/quote may relate | Quote, documents, media, equipment, labour, production, logistics | Events owner: TODO | Service offer versus Event qualification? |
| Pop-up Service | Provide temporary activation/pop-up offering | FIKA pop-up template | Deployable across locations | Occurrence/Event/Booking depending engagement | Mobilisation, equipment, logistics, media, reporting | Events/Pop-up owner: TODO | Separate from Event Service? |
| Coffee Cart Activation | Reusable mobile coffee activation | Coffee Cart template; deployment-specific occurrence | Many locations; cart itself not automatically a location | Event or occurrence; Booking when commercial request | Equipment, logistics, labour, coffee menu, pricing | Events/Coffee owner: TODO | Service Type or Template under Pop-up/Coffee? |
| Production Service | Provide production internally or commercially | CPU production candidate | From production location to demand locations | Production orders | Labour, equipment, production rules, handover | Production owner: TODO | Likely domain capability rather than Service Type. |
| Training Service | Deliver organised training | No confirmed specific service | One or many locations | Registration/occurrence TODO | Trainers, materials, rooms, documents, notifications | Workforce/Training owner: TODO | Domain, service or workflow? |
| Delivered-in Catering Service | Deliver catering produced elsewhere | Wise candidate | Destination location plus production source | Booking or recurring occurrence | Production, logistics, labour, menu/package | Operations/Commercial | Type or fulfilment method? |

## Catalogue rules for decision

- Service Type should remain a broad classification, not a substitute for requirements.
- Service Template is optional; not every service needs one.
- A Specific Service may be created from a template and then configured for its context.
- Schedule changes should not normally change Service identity.
- A dated occurrence should have its own traceable identity.
- Booking and Event remain separate domains even when created from or linked to a Service.
- Production and Logistics work remain downstream records.
- Menu/package/pricing references are versioned relationships, not copied identity.

## Catalogue decisions required

- Is “Recurring Catering” a useful Service Type or merely Hospitality/Delivered Catering plus a schedule?
- Are Breakfast, Lunch and Canapés types, templates, categories or specific services?
- Is Coffee Cart a Service Type or a named Service Template?
- Is Production ever a Service, or only a domain supporting other services?
- Is Training within Service scope?
- Which owner governs the catalogue and changes?
