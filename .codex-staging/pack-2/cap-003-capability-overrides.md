# CAP-003: Capability Overrides

- **Decision ID:** CAP-003
- **Workbook Decision ID:** DEC-CAP-003
- **Status:** Draft
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Operational Capability, Configuration

## Context

Business discovery asked: **Which capability defaults may be overridden, by whom, and through what approval?**

Before approval, the recorded evidence stated: “Real variants exist; uncontrolled overrides risk duplication.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Capability defaults should be defined centrally but may be overridden at company, client or Operational Location scope where required. Site Managers have authority to approve and manage overrides affecting activities within their own Operational Location, while centrally operated functions such as CPU remain under their relevant domain owner. Overrides must follow the ownership of the affected business area, be explicitly recorded and take effect from a defined date. Previous values must never be destroyed or overwritten, ensuring the platform can reconstruct which configuration applied at any point in time.

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
