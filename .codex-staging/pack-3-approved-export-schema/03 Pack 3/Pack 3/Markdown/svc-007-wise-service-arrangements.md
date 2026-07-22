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

Wise Monday Breakfast and Friday Lunch are separate Service Arrangements because they provide distinct Services at the same Operational Location, with different purposes, menus, operating patterns and production requirements. Each Service Arrangement owns its own operational history, configuration and one or more Recurring Schedules. Changing the day, time or recurrence pattern does not create a new Service Arrangement where the underlying Service and operational scope remain the same. Instead, the existing arrangement receives a new effective-dated schedule while preserving previous schedules for audit and reporting. A new Service Arrangement is created only when the underlying Service or its OPLOC-specific operational scope changes materially.

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

Service models must preserve the approved distinctions among Service Arrangement, Recurring Schedule, retired dated-occurrence concept, Booking and related domains.

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

## Governed amendment rationale

- retired dated-occurrence concept has been removed from the Pack 3 vocabulary.
- Monday Breakfast and Friday Lunch are distinct because of their underlying Service and operational scope, not merely because they recur on different days.
- A Service Arrangement may own one or more Recurring Schedules.
- Schedule changes should preserve the arrangement identity where the Service and operational scope remain stable.

## Governed explanatory refinements

- Remove every reference to retired dated-occurrence concept from the document.
- Clarify that both arrangements belong to the same OPLOC but represent different Services.
- Explain that changing Monday to Tuesday, or changing the service time, creates an effective-dated schedule change rather than a new arrangement.
- Explain that a material change to the underlying Service or OPLOC-specific scope may require a new Service Arrangement.

## Governed follow-up

- Later schema work must define how material arrangement changes are distinguished from effective-dated configuration and schedule changes.
Ready for export: Yes
---
