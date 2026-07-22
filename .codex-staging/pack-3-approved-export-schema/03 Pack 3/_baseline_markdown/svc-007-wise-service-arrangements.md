# SVC-007 — Wise Service Arrangements

- **Decision ID:** SVC-007
- **Workbook Decision ID:** DEC-SVC-007
- **Status:** Accepted
- **Date:** 2026-07-12T09:24:01.704Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations / Commercial
- **Related domains:** Service

## Context

Business discovery asked: **Are Wise Monday Breakfast and Friday Lunch two arrangements or occurrences of one service?**

Before approval, the recorded evidence stated: “The offers differ by day and meal; shared identity is unconfirmed.” The question was recorded as a validation decision with medium repository confidence before approval.

## Decision

Yes. Wise Monday Breakfast and Friday Lunch are two separate Service Arrangements because they are two distinct recurring services with different purposes, menus, operating patterns and production requirements. They therefore each own their own recurring schedule and generate their own dated Service Occurrences. A change to the recurring day, time or schedule of either service does not create a new Service Arrangement where the underlying service remains the same. Instead, the existing arrangement receives a new effective-dated schedule while preserving historical schedules for audit and reporting. A new Service Arrangement is only created when the underlying service itself changes materially.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `Wise test`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-007, sourced from `Questions!51`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `Wise test`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
