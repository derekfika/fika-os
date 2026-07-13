# LOC-005: Client and Operational Location Relationships

- **Decision ID:** LOC-005
- **Workbook Decision ID:** DEC-LOC-005
- **Status:** Draft
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Commercial
- **Related domains:** Operational Location, Client

## Context

Business discovery asked: **Can one client relate to several locations, and one location to several clients over time?**

Before approval, the recorded evidence stated: “Both relationship cardinalities remain unconfirmed.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

A Client may relate to multiple Operational Locations, and those relationships may change over time. An Operational Location normally has one primary commercial Client at any given time, but it may also have multiple operational contacts or stakeholder organisations responsible for the day-to-day running of the location. These operational relationships should be modelled separately from the primary commercial client relationship to avoid ambiguity while preserving historical changes over time.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Decision 1: Canonical Location`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Operational Location.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Domain models, schemas, architecture and applications must reference the Operational Location identity, lifecycle and relationship rules established here rather than creating competing place identities.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [CLIENT-001 — Client and Client Contact Definition](client-001-client-definition.md)
- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-005, sourced from `Questions!28`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Decision 1: Canonical Location`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
