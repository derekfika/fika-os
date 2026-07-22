# SVC-003 — Production and Training Domain Boundary

- **Decision ID:** SVC-003
- **Workbook Decision ID:** DEC-SVC-003
- **Status:** Accepted
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Role-based authority via AUTHMOD / Production / Workforce
- **Related domains:** Service

## Context

Business discovery asked: **Should internal production or training activities be Services, downstream domains or future capabilities?**

Before approval, the recorded evidence stated: “Production Service and Training Service were unresolved candidates.” The question was recorded as a validation decision with low repository confidence before approval.

## Decision

Internal Production and Training are modelled as their own business domains rather than as Services. They support the delivery of Services but have their own workflows, ownership, records and lifecycles. A Service Arrangement may depend on Production or Training capabilities, while those capabilities remain owned by their respective domains and may evolve independently without changing the definition of a Service. Future internal business areas should become first-class domains only where they have a defined business purpose, owner, records, workflows and operational lifecycle.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `D. Service archetypes`. Without a canonical decision, later documents or applications could interpret this subject differently.

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
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-003, sourced from `Questions!50`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `D. Service archetypes`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- The current wording alternates between domain and capability as though they are interchangeable.
- Production and Training are domains; the operational abilities they provide are capabilities owned by those domains.
- The final sentence should describe the threshold for recognising a new domain rather than suggesting that every internal capability may become one.

## Governed explanatory refinements

- Remove retired dated-occurrence concept from the implementation implications.
- Clarify that a Service Arrangement may depend on Production or Training without owning their records or workflows.
- Preserve the separate ownership and lifecycle of each domain.
- Use examples carefully: food production may fulfil a sandwich-lunch arrangement, while Training may prepare Legends to deliver a coffee service.

## Governed follow-up

- Production and Training require later domain discovery and are not defined in detail by this BDR.
- Food Production, CPU and Food Safety remain excluded discovery concepts until separately governed.
Ready for export: Yes
---
