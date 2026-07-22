# CAP-004: Capability, Domain and Permission Boundary

- **Decision ID:** CAP-004
- **Workbook Decision ID:** DEC-CAP-004
- **Status:** Draft
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Platform / Domain owners
- **Related domains:** Operational Capability

## Context

Business discovery asked: **May capabilities enable experiences without defining business meaning or granting access?**

Before approval, the recorded evidence stated: “Principles say applications consume domains and providers remain adapters.” The question was recorded as a validation decision with medium repository confidence before approval.

## Decision

An Operational Capability makes an approved business ability available within a governed operating scope, but does not define business meaning, own canonical business records, assign organisational responsibility or grant authority or information access. The business domain that owns the capability retains ownership of its concepts, records, rules, classifications and lifecycle. Capability enablement records only that the approved ability is available for the applicable Operational Location, Service Arrangement or other governed scope, subject to CAP-001 through CAP-003 and approved configuration. Authority to View, Contribute, Manage, Approve, Publish or Administer is granted separately through AUTHMOD to organisational roles for explicit business scopes and effective periods; capability availability, assignment, application access or technical administration must not create or widen those grants. A person may therefore be authorised within a domain where a capability is unavailable, or a capability may be enabled where no person currently holds a particular action, without either condition changing the other. Applications and providers consume approved domain meaning, capability state and AUTHMOD grants and must not redefine, merge or infer them. Platform Governance maintains the technical relationships, validates cross-domain consistency and audits capability-state changes, but does not acquire business ownership or permission authority through implementation.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md), specifically the section `Core decisions`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

This boundary separates business ownership from technical enablement: domain owners define meaning, accountable roles hold authority and Platform Governance implements approved controls. The [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) prevents capability administration from becoming business or access authority.

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

Capability specifications must not embed domain ownership, canonical records or permission grants. Technical enablement must consume approved domain meaning and role-based authority, and all capability-state changes must be auditable.

## Related decisions

- **Depends on:** [CAP-001 — Operational Capability Definition](cap-001-operational-capability-definition.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CAP-004, sourced from `Questions!49`.
- [docs/business-workshops/location-capability-model.md](../business-workshops/location-capability-model.md) — **Historical**; `Core decisions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work may refine technical enforcement, but must preserve the boundary among domain meaning, capability enablement and permission authority.
