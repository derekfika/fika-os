# SVC-005 — Recurring Schedule Governance

- **Decision ID:** SVC-005
- **Workbook Decision ID:** DEC-SVC-005
- **Status:** Accepted
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations
- **Related domains:** Service

## Context

Business discovery asked: **How should recurring schedules, effective dates, exceptions and occurrences be governed?**

Before approval, the recorded evidence stated: “Wise evidences recurrence; start/end and exceptions are not yet confirmed.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Recurring Schedules define repeating patterns of planned delivery for a Service Arrangement. They use effective dates so historical and future changes are preserved without overwriting previous records. A Recurring Schedule may have governed exceptions for specific dates or periods, including amendments, pauses or cancellations, without changing the underlying repeating pattern. Every exception must record its reason, approval, effective scope and audit history. FIKA OS must preserve the distinction between the normal planned schedule, approved exceptions and the operational work generated or completed from that schedule.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `E. Recurrence and scheduling`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It directly enabled [SVC-006](svc-006-scheduled-work-and-booking-boundary.md), [SVC-007](svc-007-wise-service-arrangements.md) to be decided on a stable basis.

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
- **Depends on:** [SVC-002 — Service Terminology](svc-002-service-terminology.md)
- **Directly informs:** [SVC-006 — Scheduled Work and Booking Boundary](svc-006-scheduled-work-and-booking-boundary.md)
- **Directly informs:** [SVC-007 — Wise Service Arrangements](svc-007-wise-service-arrangements.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-005, sourced from `Questions!41`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `E. Recurrence and scheduling`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- retired dated-occurrence concept has been removed from the Pack 3 vocabulary.
- The recurring pattern belongs to the Recurring Schedule, while specific operational work is generated or managed through the shared work workflow.
- Exceptions apply to specific dates or periods without silently rewriting the underlying schedule.
- The model must preserve both planned and actual operational history.

## Governed explanatory refinements

- Remove all references to retired dated-occurrence concept from the context, consequences, implementation implications and related-decision wording.
- Use Angel Court milk delivery as a grounded example: every Monday morning, with a specific Monday paused, amended or cancelled as an exception.
- Clarify that one Service Arrangement may support multiple independently identified Recurring Schedules.
- Explain that effective-dated schedule changes create new governed versions rather than overwriting history.

## Governed follow-up

- The shared operational-work concept and record name must be confirmed without reintroducing retired dated-occurrence concept.
- Later schema work must define schedule identifiers, recurrence patterns, exceptions, effective dating and links to generated work records.
Ready for export: Yes
---
r Pack 3 BDRs must define the shared scheduled-work workflow without reintroducing retired dated-occurrence concept.
Ready for export: Yes
---
