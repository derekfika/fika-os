# BRAND-001: Brand and White-Labelling Overrides

- **Decision ID:** BRAND-001
- **Workbook Decision ID:** DEC-BRAND-001
- **Status:** Draft
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / Brand owner
- **Related domains:** Brand, Configuration, Operational Location

## Context

Business discovery asked: **What co-branding, white-labelling and site-override rules apply to brand assets?**

Before approval, the recorded evidence stated: “Palette and logo override rules are open.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

Brand assets should default to approved FIKA branding but may be adapted where required to meet client agreements, co-branding arrangements or white-labelled services. Any variation from the approved FIKA brand guidelines must be deliberate, documented and approved by the Marketing and Brand function. Site-specific overrides may include client logos, colours, imagery and messaging where commercially agreed, but should not compromise accessibility, usability or the overall quality and consistency of the platform.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Configuration Inheritance`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Brand.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Brand and configuration work must preserve approved FIKA defaults, governed variations and approval responsibility.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md)
- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-BRAND-001, sourced from `Questions!45`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Configuration Inheritance`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
