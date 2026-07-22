# CAP-003: Capability Overrides

- **Decision ID:** CAP-003
- **Workbook Decision ID:** DEC-CAP-003
- **Status:** Staged for Review
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Operational Capability, Configuration

## Context

Business discovery asked: **Which capability defaults may be overridden, by whom, and through what approval?**

Before approval, the recorded evidence stated: “Real variants exist; uncontrolled overrides risk duplication.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

An Operational Capability override is an explicitly authorised, effective-dated configuration variation that changes an inherited capability value or enablement rule for a governed business scope without changing the canonical capability definition. Overrides may be created only where CAP-001, CAP-002, CFG-002 and CFG-003 permit variation for the affected capability, scope and dependency rules. No fixed universal precedence is assumed between company, client, Operational Location, Service Arrangement or other scopes; the applicable inheritance relationship and precedence must already be governed before an override can take effect. The business domain that owns the affected capability retains ownership of its meaning and protected rules, while approval authority is granted separately through AUTHMOD for the subject, scope and impact of the override. Job title, local responsibility, technical access or platform administration does not confer override authority automatically. Every override must record the inherited value or rule it changes, resulting value or state, business reason, scope, owner, approving authority, dependency and eligibility validation, start date, mandatory end date where temporary, status and complete audit history. Expired, withdrawn or revoked overrides must reveal the next valid inherited value rather than copying, deleting or rewriting history. An override must not bypass mandatory dependencies, exclusions, protected business rules or lifecycle restrictions unless a separately authorised exception explicitly permits it. Platform Governance implements validation and impact controls and preserves historical reconstruction but does not define or approve the business exception unless separately authorised through AUTHMOD.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md), specifically the section `Default and override model`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Override ownership remains with the affected business area; role-based authority determines who may approve an override. Platform Governance implements the mechanism and assesses wider impact but does not define the exception. This follows the [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md).

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

Capability override specifications must record business ownership, approving authority, scope, justification and effective dates separately from technical administration. Overrides must be fully auditable. Any temporary delegation must have a mandatory end date and must not transfer ownership.

## Related decisions

- **Depends on:** [CAP-001 — Operational Capability Definition](cap-001-operational-capability-definition.md)
- **Depends on:** [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CAP-003, sourced from `Questions!24`.
- [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md) — **Historical**; `Default and override model`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must define the evidence, review and retirement rules for overrides without changing the approved scope hierarchy.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
