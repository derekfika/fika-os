# SVC-008 — Service and Event Boundary

- **Decision ID:** SVC-008
- **Workbook Decision ID:** DEC-SVC-008
- **Status:** Accepted
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Role-based authority via AUTHMOD / Events / Commercial
- **Related domains:** Service, Events

## Context

Business discovery asked: **How does a service offer relate to an Event without duplicating lifecycle or ownership?**

Before approval, the recorded evidence stated: “Event Service is an offer candidate; qualifying activity becomes an Event.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

A Service defines a durable reusable offering. An Event is a distinct customer-, client- or occasion-specific activity that owns its own purpose, planning, approval, delivery and lifecycle. An Event may use, reference or purchase one or more existing Services or Service Arrangements without becoming a Service Arrangement, Recurring Schedule or Hospitality Booking. The Event domain owns the Event record and lifecycle; the Service domain continues to own the reusable Service definitions and OPLOC-specific Service Arrangements that support it.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `J. Domain boundaries`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

- **Depends on:** [SVC-001 — Service Definition](svc-001-service-definition.md)
- **Depends on:** [EVT-001 — Event Qualification Boundary](evt-001-event-qualification.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-008, sourced from `Questions!43`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `J. Domain boundaries`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- retired dated-occurrence concept has been removed from the Pack 3 vocabulary.
- The boundary should be based on ownership and lifecycle, not recurrence alone.
- An Event may consume several Services while remaining one governed Event.
- A Service or Service Arrangement does not become an Event merely because it supports a bespoke activity.
- Hospitality Booking remains a separate request type and should not be used as a synonym for Event.

## Governed explanatory refinements

- Preserve Event as the established FIKA business concept and domain language.
- Add a grounded example: a bespoke client celebration may use catering, coffee and staffing Services while the Event owns its overall brief, approvals, timing and delivery plan.
- Remove retired dated-occurrence concept from the Decision and implementation implications.
- Clarify that references between Event and Service records do not transfer ownership of either record.
- Replace the generic named owner “Derek / Events / Commercial” with role-based business ownership governed through AUTHMOD where the BDR format allows.

## Governed follow-up

- EVT-001 remains authoritative for deciding what qualifies as an Event.
- Later Event-domain discovery must define Event relationships to Hospitality Bookings, OPEXP and operational work without collapsing those concepts together.
Ready for export: Yes
--
