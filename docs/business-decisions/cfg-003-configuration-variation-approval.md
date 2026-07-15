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

Configuration may vary only within explicitly governed business scopes and subject to protected rules defined by the owning domain. Each variation remains owned by the accountable role for the affected business scope, while approval authority is granted separately through AUTHMOD and must be appropriate to the variation’s subject, scope and impact. Job titles or broad labels such as operational or commercial do not confer authority by themselves. An authorised variation is an effective-dated override of an inherited or default value, not an independent local configuration. Every variation must record the value it overrides, its scope, reason, owner, approving authority, effective period, validation outcome and complete audit history. Temporary delegated authority must have a fixed end date and never transfers ownership. Platform Governance assesses cross-domain, reporting, migration and technical impact but does not approve the business exception unless separately authorised through AUTHMOD.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Configuration Inheritance`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

The owner of the affected business area remains accountable for a variation, while approval authority follows the relevant accountable role or function under the [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md). Platform Governance assesses wider schema, reporting, migration or cross-domain impact; it does not decide the business exception.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Configuration.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

- Ownership, authority and technical administration are now explicitly separated and traceable.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

- Role-based approval, audit history and time limits add governance effort but prevent technical or temporary access from becoming permanent business authority.

## Implementation implications

Configuration specifications must preserve the ownership, scope, inheritance, effective-date and approval rules established here without embedding provider or application assumptions.

This BDR does not select a database, API, provider, application design or deployment approach.

Configuration specifications must distinguish the business owner, approving authority, effective period and technical administrator for every exception. Changes must be versioned or effective-dated where applicable and fully auditable. Temporary delegated authority must have a mandatory end date and must not transfer ownership.

## Related decisions

- **Depends on:** [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md)
- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Depends on:** [SVC-001 — Service Definition](svc-001-service-definition.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CFG-003, sourced from `Questions!26`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Configuration Inheritance`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must define the evidence and review cadence for exceptions without changing which business role owns or approves each variation.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
