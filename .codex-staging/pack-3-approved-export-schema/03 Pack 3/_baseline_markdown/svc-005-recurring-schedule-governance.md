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

Recurring schedules should define the normal pattern of operation using effective dates that preserve historical and future changes without overwriting previous records. Individual occurrences should inherit the recurring schedule by default but may be amended or cancelled as approved exceptions without changing the underlying pattern. All exceptions must record their reason, approval and effective period, allowing the business to distinguish between the planned schedule and what actually occurred while maintaining a complete audit history.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `E. Recurrence and scheduling`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It directly enabled [SVC-006](svc-006-service-occurrence-booking-boundary.md), [SVC-007](svc-007-wise-service-arrangements.md) to be decided on a stable basis.

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
- **Depends on:** [SVC-002 — Service Terminology](svc-002-service-terminology.md)
- **Directly informs:** [SVC-006 — Service Occurrence and Booking Boundary](svc-006-service-occurrence-booking-boundary.md)
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
