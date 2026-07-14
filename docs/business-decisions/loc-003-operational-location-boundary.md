# LOC-003: Operational Location Ownership Boundary

- **Decision ID:** LOC-003
- **Workbook Decision ID:** DEC-LOC-003
- **Status:** Accepted
- **Date:** 2026-07-12T08:31:57.824Z
- **Decision owner:** Derek / Operations / Domain owners
- **Related domains:** Operational Location

## Context

An OPLOC must anchor activity associated with a place without becoming a container that owns every detailed record connected to it. Clear ownership boundaries prevent the location record from absorbing specialist business meaning.

## Decision

A canonical Operational Location owns only the durable facts that define the long-term identity of a place FIKA operates within, including its approved name, historical aliases, lifecycle, stable identity and durable relationships with other business objects. It does not own provider integrations, application configuration, branding, physical address master data, menus, pricing, equipment inventory, staffing, calendars, bookings, events, services or other operational records that belong to their own business domains. The Operational Location provides the permanent business anchor to which those domains relate, rather than containing or controlling them.

## Business rationale

The OPLOC directly represents only the durable facts that identify the operating context: stable identity, approved name, historical aliases, lifecycle and durable links to other business concepts.

Client organisations and contacts, provider integrations, application configuration, branding, address master data, menus and pricing, equipment, staffing, calendars, Bookings, Events, Services, commercial agreements and Operational Capabilities each require their own domain ownership. Those domains relate their records to the OPLOC.

## Positive consequences

- The OPLOC remains stable and understandable as specialist domains evolve.

- Each domain can govern its own records without duplicating or embedding them inside the OPLOC.

- Relationships to Clients, Services, capabilities and other concepts can change without recreating the location.

- Teams can find the durable operational anchor while following links to the authoritative detail.

## Trade-offs

- Consumers may need to combine the OPLOC with records from several related domains.

- Domain ownership and relationship boundaries must be explicit to avoid duplicated facts.

- Not every useful location-related fact belongs directly on the OPLOC, even when displaying it alongside the location is convenient.

## Implementation implications

- Future OPLOC schemas should contain only durable identity and lifecycle facts plus stable references needed to relate specialist records.

- Detailed provider, configuration, brand, address, menu, pricing, equipment, workforce, calendar, Booking, Event, Service, commercial and capability data must remain owned by their respective domains.

- Applications may assemble a location view from related domains but must not treat that projection as OPLOC ownership.

## Related decisions

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-003, sourced from `Questions!16`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Candidate responsibility boundary`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

- Stage 5 should test every proposed OPLOC field against the ownership boundary before including it.

- Future BDRs must establish ownership for Commercial Agreements and other candidate domains before their detailed records become canonical.
