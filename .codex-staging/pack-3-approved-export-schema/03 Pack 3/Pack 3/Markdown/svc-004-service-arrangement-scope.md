# SVC-004 — Service Arrangement Scope

- **Decision ID:** SVC-004
- **Workbook Decision ID:** DEC-SVC-004
- **Status:** Accepted
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations / Commercial
- **Related domains:** Service, Client, Operational Location

## Context

Business discovery asked: **Can one service arrangement span several locations, clients or service locations?**

Before approval, the recorded evidence stated: “Service cardinality is not confirmed.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

A Service Arrangement belongs to one Operational Location and defines how one Service is provided within that operational scope. It must not span multiple Operational Locations. Where the same Service is provided at multiple locations, each location has its own Service Arrangement with its own operational history, configuration and lifecycle. A Service Arrangement may have no recurring schedule, one recurring schedule or multiple recurring schedules, and may support independent bookings or other operational requests. Client and commercial relationships are referenced separately and do not define the Service Arrangement boundary. Shared standards, menus, templates or operating models may be reused across Service Arrangements, but each arrangement remains operationally distinct.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `F. Location relationships`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It provides stable business meaning for later BDR, schema and architecture work.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Service models must preserve the approved distinctions among Service Arrangement, Recurring Schedule, retired dated-occurrence concept, Booking and related domains.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [CLIENT-001 — Client and Client Contact Definition](client-001-client-definition.md)
- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Depends on:** [SVC-001 — Service Definition](svc-001-service-definition.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-004, sourced from `Questions!40`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `F. Location relationships`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- A Service Arrangement is not necessarily recurring; repeatability belongs to Recurring Schedule.
- The OPLOC is the stable operational boundary.
- Client and commercial relationships should not be embedded into the Service Arrangement boundary.
- “Service location” is undefined and should not become a second location concept beside OPLOC.
- The model must support both recurring work, such as Angel Court milk deliveries, and independent Hospitality Bookings using the same arrangement.

## Governed explanatory refinements

- Remove retired dated-occurrence concept from implementation implications.
- Explain that one Service Arrangement may support recurring schedules, independent bookings and similar operational requests.
- Add an example showing the same Service implemented as separate arrangements at different OPLOCs.
- Preserve separate history, configuration and lifecycle for each OPLOC-specific arrangement.

## Governed follow-up

- Later BDRs must define whether a Service Arrangement may have multiple Recurring Schedules and how each schedule is identified.
- Client and commercial-agreement scope remains governed outside this BDR.
Ready for export: Yes
---
