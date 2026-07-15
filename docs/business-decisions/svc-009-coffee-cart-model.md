# SVC-009 — Coffee Cart Model

- **Decision ID:** SVC-009
- **Workbook Decision ID:** DEC-SVC-009
- **Status:** Accepted
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Role-based authority via AUTHMOD / Coffee / Events / Equipment
- **Related domains:** Service

## Context

Business discovery asked: **Is Coffee Cart an equipment asset plus reusable service template, and how is availability allocated?**

Before approval, the recorded evidence stated: “The discovery explicitly raises this boundary.” The question was recorded as a validation decision with medium repository confidence before approval.

## Decision

The Coffee Cart is an Equipment asset. Coffee-cart provision is a reusable Service. An OPLOC-specific implementation of that Service is governed through a Service Arrangement, while an Event may reference the Service and request allocation of the Coffee Cart without becoming a Service Arrangement. Availability is determined by the governed allocation of the physical asset, authorised staff, time and location rather than by the Service definition itself. The same Coffee Cart may support different Service Arrangements or Events over time but must not have conflicting allocations.

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
- **Depends on:** [SVC-002 — Service Terminology](svc-002-service-terminology.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-009, sourced from `Questions!52`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `D. Service archetypes`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- Service Template remains unresolved and should not be adopted through this BDR.
- The physical Coffee Cart and the reusable coffee-cart Service are separate governed concepts.
- OPLOC-specific delivery belongs to a Service Arrangement.
- Event-specific use remains owned by the Event while referencing the Service and asset allocation.
- Availability is constrained by asset, staff, time and location, not by whether the Service exists.
- The model must prevent conflicting allocations of the same physical asset.

## Governed explanatory refinements

- Remove retired dated-occurrence concept from the implementation implications.
- Distinguish Equipment ownership and lifecycle from Service ownership and lifecycle.
- Add one OPLOC example and one Event example.
- Clarify that allocation does not transfer ownership of the Equipment asset.
- Replace named Decision ownership with role-based business ownership governed through AUTHMOD where the BDR format allows.

## Governed follow-up

- Equipment-domain discovery must define asset identity, status, maintenance, availability and allocation history.
- Later architecture must determine how asset, staff and schedule conflicts are validated across Service Arrangements and Events.
- Service Template terminology remains unresolved and must not appear in the adopted Decision.
Ready for export: Yes
---
-
