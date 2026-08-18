# CFG-002 — Configuration Inheritance

- **Decision ID:** CFG-002
- **Workbook Decision ID:** DEC-CFG-002
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / Platform / Domain owners
- **Related domains:** Configuration

## Context

Business discovery asked: **What is the inheritance and precedence order, including missing values and effective dates?**

Before approval, the recorded evidence stated: “Multiple scopes are proposed; precedence remains open.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Configuration values inherit only through explicitly governed scope relationships. A value defined at a more specific applicable scope overrides an inherited value from a broader scope, while an absent value continues to inherit the nearest valid effective value. No universal precedence order is assumed between unrelated scopes: where two applicable scopes could conflict, the owning domain must define and govern the permitted relationship and precedence rule before use. Every override must be authorised through AUTHMOD, effective-dated, validated for its scope and dependencies, and preserved with its reason, approver and audit history. Expired or withdrawn overrides reveal the next valid inherited value rather than copying or rewriting it. User- or application-level configuration must not override protected business rules unless that authority is explicitly granted.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Configuration Inheritance`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Configuration.

It provides stable business meaning for later BDR, schema and architecture work.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Configuration specifications must preserve the ownership, scope, inheritance, effective-date and approval rules established here without embedding provider or application assumptions.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CFG-002, sourced from `Questions!25`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Configuration Inheritance`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
