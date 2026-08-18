# CAP-002: Capability Optionality and Dependencies

- **Decision ID:** CAP-002
- **Workbook Decision ID:** DEC-CAP-002
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Operational Capability

## Context

Business discovery asked: **Are all capabilities optional, and how are dependencies or exclusions expressed?**

Before approval, the recorded evidence stated: “Wise shows not every location needs the same systems or a till.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Operational Capabilities are optional unless an approved business rule makes a capability mandatory for a defined operating scope. Capabilities may be combined only where the resulting operating model is valid under the owning domains’ governed dependency, exclusion, eligibility and lifecycle rules. Each dependency rule must identify the capability or governed condition on which enablement depends, whether the rule is mandatory, conditional or advisory, the applicable scope, effective period, owning domain, approving authority and audit history. Exclusion rules must identify combinations that are prohibited or require an approved exception. A capability may operate without another capability where no governed dependency applies and the complete business workflow remains valid. Capability enablement must not be inferred from client request, location type, application availability or technical configuration alone. Every enabled capability must have an accountable business owner for its operating scope, while approval authority and technical administration remain separate under AUTHMOD. Platform Governance validates and enforces approved dependency rules and assesses cross-domain impact but does not invent business dependencies or exceptions. Operational Locations and other authorised scopes may select only valid combinations from the approved catalogue and must not bypass mandatory rules or create local dependency semantics.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md), specifically the section `Core decisions`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Capability owners define valid dependency and exclusion rules as business rules. Platform Governance implements and validates those approved rules but does not invent them. Approval authority follows accountable roles or functions under the [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md).

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Operational Capability.
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

Capability catalogues and configuration must preserve approved optionality, dependencies, ownership and boundaries without granting permissions or redefining domain meaning.

This BDR does not select a database, API, provider, application design or deployment approach.

Capability specifications must preserve approved optionality, dependencies and exclusions as versioned, auditable rules. Business ownership, approval authority and technical enforcement must remain distinct, and administrators must not redefine domain meaning through configuration.

## Related decisions

- **Depends on:** [CAP-001 — Operational Capability Definition](cap-001-operational-capability-definition.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CAP-002, sourced from `Questions!23`.
- [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md) — **Historical**; `Core decisions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must confirm the catalogue of dependencies and exclusions and the role authorised to approve material changes to it.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
