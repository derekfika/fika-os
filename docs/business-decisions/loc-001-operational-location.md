# LOC-001: Operational Location Definition

- **Decision ID:** LOC-001
- **Workbook Decision ID:** DEC-LOC-001
- **Status:** Draft
- **Date:** 2026-07-12T07:40:53.482Z
- **Decision owner:** Derek / Operations
- **Related domains:** Operational Location, Configuration, Service, Brand, Production

## Context

Business discovery asked: **What does the canonical operational-location object represent in plain business language?**

Before approval, the recorded evidence stated: “Evidence supports a durable place or operating context recognised by FIKA.” The question was recorded as a foundation decision with medium repository confidence before approval.

## Decision

An Operational Location is a site, venue or recurring operating context that FIKA works with over time. It provides a single durable identity that allows services, events, clients and operational history to be consistently associated with the same place, even if names, providers or individual services change.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Decision 1: Canonical Location`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Operational Location.
- It directly enabled [LOC-002](loc-002-operational-location-name.md), [LOC-003](loc-003-operational-location-boundary.md), [LOC-004](loc-004-operational-location-lifecycle.md), [TYPE-001](type-001-location-type-requirement.md), [LOC-006](loc-006-single-building-address.md), [CFG-003](cfg-003-configuration-variation-approval.md), [LOC-005](loc-005-client-operational-location-relationships.md), [SVC-004](svc-004-service-arrangement-scope.md), [BRAND-001](brand-001-brand-overrides.md), [TYPE-002](type-002-primary-location-type.md), [TYPE-003](type-003-location-type-history.md), [PROD-005](prod-005-multi-facility-production-routing.md) to be decided on a stable basis.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Domain models, schemas, architecture and applications must reference the Operational Location identity, lifecycle and relationship rules established here rather than creating competing place identities.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Directly informs:** [LOC-002 — Operational Location Name](loc-002-operational-location-name.md)
- **Directly informs:** [LOC-003 — Operational Location Ownership Boundary](loc-003-operational-location-boundary.md)
- **Directly informs:** [LOC-004 — Operational Location Lifecycle](loc-004-operational-location-lifecycle.md)
- **Directly informs:** [TYPE-001 — Location Type Requirement and Ownership](type-001-location-type-requirement.md)
- **Directly informs:** [LOC-006 — Operational Location Building and Address Boundary](loc-006-single-building-address.md)
- **Directly informs:** [CFG-003 — Configuration Variation and Approval](cfg-003-configuration-variation-approval.md)
- **Directly informs:** [LOC-005 — Client and Operational Location Relationships](loc-005-client-operational-location-relationships.md)
- **Directly informs:** [SVC-004 — Service Arrangement Scope](svc-004-service-arrangement-scope.md)
- **Directly informs:** [BRAND-001 — Brand and White-Labelling Overrides](brand-001-brand-overrides.md)
- **Directly informs:** [TYPE-002 — Primary Location Type](type-002-primary-location-type.md)
- **Directly informs:** [TYPE-003 — Location Type History](type-003-location-type-history.md)
- **Directly informs:** [PROD-005 — Multi-Facility Production Routing](prod-005-multi-facility-production-routing.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-001, sourced from `Questions!3`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Decision 1: Canonical Location`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
