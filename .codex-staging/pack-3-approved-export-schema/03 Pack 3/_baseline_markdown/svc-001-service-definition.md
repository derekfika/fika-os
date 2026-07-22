# SVC-001 — Service Definition

- **Decision ID:** SVC-001
- **Workbook Decision ID:** DEC-SVC-001
- **Status:** Accepted
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations / Commercial
- **Related domains:** Service, Configuration

## Context

Business discovery asked: **What stable business concept should FikaService represent?**

Before approval, the recorded evidence stated: “A reusable commitment or offer is proposed, distinct from a dated occurrence, but not adopted.” The question was recorded as a foundation decision with medium repository confidence before approval.

## Decision

A durable definition of what FIKA provides, distinct from a dated occurrence and capability.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `A. Plain-English definition`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It directly enabled [CFG-003](cfg-003-configuration-variation-approval.md), [SVC-002](svc-002-service-terminology.md), [SVC-004](svc-004-service-arrangement-scope.md), [SVC-005](svc-005-recurring-schedule-governance.md), [SVC-008](svc-008-service-event-boundary.md), [SVC-010](svc-010-service-commercial-ownership.md), [SVC-003](svc-003-production-training-domain-boundary.md), [SVC-009](svc-009-coffee-cart-model.md) to be decided on a stable basis.

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

- **Directly informs:** [CFG-003 — Configuration Variation and Approval](cfg-003-configuration-variation-approval.md)
- **Directly informs:** [SVC-002 — Service Terminology](svc-002-service-terminology.md)
- **Directly informs:** [SVC-004 — Service Arrangement Scope](svc-004-service-arrangement-scope.md)
- **Directly informs:** [SVC-005 — Recurring Schedule Governance](svc-005-recurring-schedule-governance.md)
- **Directly informs:** [SVC-008 — Service and Event Boundary](svc-008-service-event-boundary.md)
- **Directly informs:** [SVC-010 — Service Commercial Ownership](svc-010-service-commercial-ownership.md)
- **Directly informs:** [SVC-003 — Production and Training Domain Boundary](svc-003-production-training-domain-boundary.md)
- **Directly informs:** [SVC-009 — Coffee Cart Model](svc-009-coffee-cart-model.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-001, sourced from `Questions!8`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `A. Plain-English definition`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
