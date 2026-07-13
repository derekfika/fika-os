# EVT-001: Event Qualification Boundary

- **Decision ID:** EVT-001
- **Workbook Decision ID:** DEC-EVT-001
- **Status:** Draft
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Derek / Events owner
- **Related domains:** Events, Service

## Context

Business discovery asked: **What conditions make an activity a canonical Event rather than a service occurrence or hospitality booking?**

Before approval, the recorded evidence stated: “Confirmed event contexts exist, but the qualification threshold was unresolved at that point.” The question was recorded as a foundation decision with low repository confidence before approval.

## Decision

An Event is a bespoke offering delivered at an Operational Location that is planned specifically for a customer or occasion. Events are not part of FIKA's recurring service schedule and typically require approval from the Events Lead or, where appropriate, the Site Manager. Examples include parties, BBQs, canapé receptions, bowl food events and other bespoke hospitality experiences. A Service Occurrence is a scheduled, repeatable operation that forms part of the normal running of an Operational Location. Examples include coffee bars, restaurants, grab-and-go, delivered-in catering and other recurring services. A Hospitality Booking is a one-off request delivered using an existing Service Occurrence. It does not create a new Event. Examples include meeting room tea and coffee, sandwich lunches and standard hospitality orders.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `J. Domain boundaries`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Events.
- It directly enabled [EVT-002](evt-002-event-governance.md), [SVC-008](svc-008-service-event-boundary.md) to be decided on a stable basis.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Event records and workflows must preserve the approved boundary between Event, Service Occurrence and Booking and must respect the stated approval ownership.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Directly informs:** [EVT-002 — Event Governance](evt-002-event-governance.md)
- **Directly informs:** [SVC-008 — Service and Event Boundary](svc-008-service-event-boundary.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-EVT-001, sourced from `Questions!5`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `J. Domain boundaries`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
