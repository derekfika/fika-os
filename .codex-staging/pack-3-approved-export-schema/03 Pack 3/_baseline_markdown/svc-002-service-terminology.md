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

Use Service for the durable offering or arrangement and Service Occurrence for a scheduled, repeatable operation. A Hospitality Booking is a one-off request fulfilled through an existing Service Occurrence. Family, template and schedule terminology still requires confirmation.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `Recommended conceptual layers`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It directly enabled [SVC-005](svc-005-recurring-schedule-governance.md), [SVC-006](svc-006-service-occurrence-booking-boundary.md), [SVC-007](svc-007-wise-service-arrangements.md), [SVC-009](svc-009-coffee-cart-model.md) to be decided on a stable basis.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Service models must preserve the approved distinctions among Service Arrangement, Recurring Schedule, Service Occurrence, Booking and related domains.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [SVC-001 — Service Definition](svc-001-service-definition.md)
- **Directly informs:** [SVC-005 — Recurring Schedule Governance](svc-005-recurring-schedule-governance.md)
- **Directly informs:** [SVC-006 — Service Occurrence and Booking Boundary](svc-006-service-occurrence-booking-boundary.md)
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
