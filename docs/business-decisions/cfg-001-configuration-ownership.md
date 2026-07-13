# CFG-001: Configuration Ownership

- **Decision ID:** CFG-001
- **Workbook Decision ID:** DEC-CFG-001
- **Status:** Draft
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Configuration, Operational Capability, Service, Brand

## Context

Business discovery asked: **Who owns configuration at organisation, client, brand, location, application and user scope, including override approval?**

Before approval, the recorded evidence stated: “Ownership is fragmented and override authority remains open.” The question was recorded as a foundation decision with low repository confidence before approval.

## Decision

Configuration ownership is determined by business scope. The Platform Owner governs organisation-wide configuration and the configuration model itself. Client, Brand, Capability, Operational Location and Application owners govern configuration within their respective business areas. Site Managers may approve and manage configuration affecting their own Operational Location, while centrally operated functions such as CPU remain under their designated domain owner. Ownership may be delegated through FIKA OS role assignments without changing the canonical governance model.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Configuration Inheritance`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Configuration.
- It directly enabled [CAP-003](cap-003-capability-overrides.md), [CFG-002](cfg-002-configuration-inheritance.md), [CFG-003](cfg-003-configuration-variation-approval.md), [SVC-010](svc-010-service-commercial-ownership.md), [BRAND-001](brand-001-brand-overrides.md) to be decided on a stable basis.
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

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
