# SVC-006 — Service Occurrence and Booking Boundary

- **Decision ID:** SVC-006
- **Workbook Decision ID:** DEC-SVC-006
- **Status:** Accepted
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations / Hospitality
- **Related domains:** Service

## Context

Business discovery asked: **When does a dated occurrence require a Booking, and when may it exist without one?**

Before approval, the recorded evidence stated: “A Wise delivery must not automatically be classified as a Booking.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

A dated Service Occurrence represents a scheduled instance of a recurring Service Arrangement and may exist without any Bookings. It defines that the service is available to operate at a particular time and place. A Booking is only required when a customer requests, reserves or purchases something from that Service Occurrence or from a bespoke Event. For example, the Munich Re Coffee Bar operates through recurring Service Occurrences without requiring Bookings, whereas a sandwich lunch for fifteen people on the seventh floor of Angel Court creates a Booking against an existing Service. A Booking therefore records customer demand, while a Service Occurrence records operational availability.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `C. Service versus booking`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

Service models must preserve the approved distinctions among Service Arrangement, Recurring Schedule, Service Occurrence, Booking and related domains.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [SVC-002 — Service Terminology](svc-002-service-terminology.md)
- **Depends on:** [SVC-005 — Recurring Schedule Governance](svc-005-recurring-schedule-governance.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-006, sourced from `Questions!42`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `C. Service versus booking`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
