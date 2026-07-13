# CFG-003: Configuration Variation and Approval

- **Decision ID:** CFG-003
- **Workbook Decision ID:** DEC-CFG-003
- **Status:** Draft
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Configuration, Operational Location, Service

## Context

Business discovery asked: **Which booking rules, routing, recipients, calendars, menus and pricing may vary, and who approves exceptions?**

Before approval, the recorded evidence stated: “Each area has an open ownership or override question.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

Booking rules, routing, recipients, calendars, menus and pricing may vary where required to meet the operational or commercial needs of a client, Operational Location or Service, but each variation must have a clearly defined business owner. Operational changes such as routing, recipients and calendars should be approved by the relevant Site Manager or Operations. Commercial changes such as menus and pricing should be approved by the appropriate commercial or culinary owner. Platform-wide defaults should remain the standard, with exceptions recorded, justified and approved rather than becoming independent local configurations.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Configuration Inheritance`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Configuration.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Configuration specifications must preserve the ownership, scope, inheritance, effective-date and approval rules established here without embedding provider or application assumptions.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md)
- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Depends on:** [SVC-001 — Service Definition](svc-001-service-definition.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CFG-003, sourced from `Questions!26`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Configuration Inheritance`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
