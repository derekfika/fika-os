# SVC-002 — Service Terminology

- **Decision ID:** SVC-002
- **Workbook Decision ID:** DEC-SVC-002
- **Status:** Accepted
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations / Commercial
- **Related domains:** Service

## Context

Business discovery asked: **What vocabulary distinguishes service family, template, arrangement, schedule and occurrence?**

Before approval, the recorded evidence stated: “Several layers are discovered but their names and boundaries are not adopted.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Use Service for the durable offering. Use Service Arrangement for the governed way that a Service is provided within a defined scope. Use Recurring Schedule for a repeating pattern of planned delivery. A Hospitality Booking is an independent request for hospitality work and does not require a Service Occurrence. Other recurring operational requests may use the same scheduling and fulfilment workflow without being classified as Hospitality Bookings. Family and template terminology still requires confirmation.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `Recommended conceptual layers`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It directly enabled [SVC-005](svc-005-recurring-schedule-governance.md), [SVC-006](svc-006-scheduled-work-and-booking-boundary.md), [SVC-007](svc-007-wise-service-arrangements.md), [SVC-009](svc-009-coffee-cart-model.md) to be decided on a stable basis.

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
- **Directly informs:** [SVC-005 — Recurring Schedule Governance](svc-005-recurring-schedule-governance.md)
- **Directly informs:** [SVC-006 — Scheduled Work and Booking Boundary](svc-006-scheduled-work-and-booking-boundary.md)
- **Directly informs:** [SVC-007 — Wise Service Arrangements](svc-007-wise-service-arrangements.md)
- **Directly informs:** [SVC-009 — Coffee Cart Model](svc-009-coffee-cart-model.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-002, sourced from `Questions!39`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `Recommended conceptual layers`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- The current wording incorrectly treats Service and Service Arrangement as interchangeable.
- retired dated-occurrence concept is removed from the Pack 3 vocabulary because it does not represent a distinct business concept used by FIKA.
- Repeatability belongs to the Recurring Schedule.
- Hospitality Bookings remain independent requests rather than occurrences of another scheduled service.
- Similar recurring operational work, such as Angel Court milk deliveries, may use the same scheduling and fulfilment workflow without being reclassified as Hospitality Bookings.

## Governed explanatory refinements

- Add grounded examples showing Service → Service Arrangement → Recurring Schedule where relevant.
- Use Angel Court recurring milk deliveries to demonstrate that recurring operational requests can share a workflow with Hospitality Bookings while remaining a separate business classification.
- Remove retired dated-occurrence concept from explanatory text, implementation implications and downstream Pack 3 decisions.
- Keep family and template terminology unresolved until separately confirmed.

## Governed follow-up

- Confirm the final meaning of Service Family and Service Template in later Pack 3 BDRs.
- Later Pack 3 BDRs must define the shared scheduled-work workflow without reintroducing retired dated-occurrence concept.
Ready for export: Yes
---
