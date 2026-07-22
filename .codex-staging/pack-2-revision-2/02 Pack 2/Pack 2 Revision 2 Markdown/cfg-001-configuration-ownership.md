# CFG-001: Configuration Ownership

- **Decision ID:** CFG-001
- **Workbook Decision ID:** DEC-CFG-001
- **Status:** Staged for Review
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Configuration, Operational Capability, Service, Brand

## Context

Business discovery asked: **Who owns configuration at organisation, client, brand, location, application and user scope, including override approval?**

Before approval, the recorded evidence stated: “Ownership is fragmented and override authority remains open.” The question was recorded as a foundation decision with low repository confidence before approval.

## Decision

Configuration ownership is assigned by business scope to accountable organisational roles. Organisation-wide configuration and the configuration model are owned by the accountable organisation-wide configuration role. Client, Brand, Operational Capability, Operational Location, Application and other domain-scoped configuration are owned by accountable roles for those business scopes. Approval authority is granted separately through AUTHMOD and may be narrower than ownership. Authorised operational roles may administer or apply approved configuration without acquiring ownership or authority to redefine business meaning. Temporary delegation must have a defined scope, fixed end date and complete audit history, and never transfers ownership. Platform Governance assesses cohesion and downstream impact but does not replace business ownership or approval authority.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Configuration Inheritance`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Business ownership determines configuration meaning and scope; approval authority belongs to accountable organisational roles or functions under the [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md). Operational administration applies approved configuration without acquiring authority to redefine the business concept. Platform Governance assesses cohesion and downstream impact but does not define business authority.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Configuration.
- It directly enabled [CAP-003](cap-003-capability-overrides.md), [CFG-002](cfg-002-configuration-inheritance.md), [CFG-003](cfg-003-configuration-variation-approval.md), [SVC-010](svc-010-service-commercial-ownership.md), [BRAND-001](brand-001-brand-overrides.md) to be decided on a stable basis.
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

Configuration specifications must distinguish business ownership, approval authority and technical administration. Any delegation must be temporary, have a mandatory end date, remain fully auditable and never transfer ownership. Platform Governance implements approved authority and assesses cross-domain, reporting and migration impact.

## Related decisions

- **Directly informs:** [CAP-003 — Capability Overrides](cap-003-capability-overrides.md)
- **Directly informs:** [CFG-002 — Configuration Inheritance](cfg-002-configuration-inheritance.md)
- **Directly informs:** [CFG-003 — Configuration Variation and Approval](cfg-003-configuration-variation-approval.md)
- **Directly informs:** [SVC-010 — Service Commercial Ownership](svc-010-service-commercial-ownership.md)
- **Directly informs:** [BRAND-001 — Brand and White-Labelling Overrides](brand-001-brand-overrides.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CFG-001, sourced from `Questions!3`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Configuration Inheritance`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must identify accountable organisational roles for each scope and the audit evidence for effective-dated changes without replacing the approved ownership model.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
