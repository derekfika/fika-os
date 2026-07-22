# CAP-001: Operational Capability Definition

- **Decision ID:** CAP-001
- **Workbook Decision ID:** DEC-CAP-001
- **Status:** Staged for Review
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Operational Capability, Mobilisation

## Context

Business discovery asked: **What qualifies as an operational capability, and who owns its approved catalogue?**

Before approval, the recorded evidence stated: “The candidate catalogue mixes business capabilities and presentation choices; ownership is unconfirmed.” The question was recorded as a foundation decision with low repository confidence before approval.

## Decision

An Operational Capability is a governed, reusable business ability that may be enabled within an applicable Operational Location, Service Arrangement or other approved operating scope to support how FIKA delivers work. It describes what the business is able to do and must not define a business domain, organisational role, application, provider, location identity, presentation choice or implementation method. Each Operational Capability belongs to the business domain that owns its meaning, rules and lifecycle. Operations Leadership owns the organisation-wide Operational Capability Catalogue and is accountable for its coherence across FIKA, while the relevant domain owner defines and maintains each capability’s business meaning, eligibility, dependencies and lifecycle requirements. Catalogue additions, material changes, renames, mergers and retirements require explicit approval through AUTHMOD, effective dating, impact assessment and complete audit history. Platform Governance maintains the technical representation and assesses cross-domain, reporting, migration and implementation impact, but does not create or own business capabilities. Operational Locations and other authorised scopes may enable or disable approved capabilities only where permitted by governed configuration and dependency rules; they must not create local capability definitions or alter canonical meaning.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md), specifically the section `Core decisions`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

The catalogue has business meaning and therefore requires accountable Operations and domain ownership. Platform Governance may implement the catalogue and assess cohesion, but it does not acquire authority to define capabilities merely by administering the platform. This follows the [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md).

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Operational Capability.
- It directly enabled [CAP-002](cap-002-capability-optionality-dependencies.md), [CAP-003](cap-003-capability-overrides.md), [MOB-004](mob-004-mobilisation-task-classification.md), [CAP-004](cap-004-capability-domain-permission-boundary.md) to be decided on a stable basis.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

- Ownership, authority and technical administration are now explicitly separated and traceable.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

- Role-based approval, audit history and time limits add governance effort but prevent technical or temporary access from becoming permanent business authority.

## Implementation implications

Capability catalogues and configuration must preserve approved optionality, dependencies, ownership and boundaries without granting permissions or redefining domain meaning.

This BDR does not select a database, API, provider, application design or deployment approach.

Capability specifications must identify the accountable business owner, the role authorised to approve catalogue changes and the technical administrator separately. Material additions, renames or retirements must be auditable and assessed by Platform Governance for cross-domain, reporting and migration impact.

## Related decisions

- **Directly informs:** [CAP-002 — Capability Optionality and Dependencies](cap-002-capability-optionality-dependencies.md)
- **Directly informs:** [CAP-003 — Capability Overrides](cap-003-capability-overrides.md)
- **Directly informs:** [MOB-004 — Mobilisation Task Classification](mob-004-mobilisation-task-classification.md)
- **Directly informs:** [CAP-004 — Capability, Domain and Permission Boundary](cap-004-capability-domain-permission-boundary.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CAP-001, sourced from `Questions!2`.
- [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md) — **Historical**; `Core decisions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must confirm the role-based approval boundary for catalogue changes and the evidence required for each capability lifecycle transition.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
