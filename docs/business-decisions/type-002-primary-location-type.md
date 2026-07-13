# TYPE-002: Primary Location Type

- **Decision ID:** TYPE-002
- **Workbook Decision ID:** DEC-TYPE-002
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Operational Location

## Context

Business discovery asked: **May a location have one primary type or several simultaneous types?**

Before approval, the recorded evidence stated: “The Line may combine hospitality and event-venue characteristics.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

Every Operational Location has one primary Location Type that defines its default operating model. Additional classifications may be applied where required for reporting or capability selection, but they must not replace the primary type or create ambiguity about the location's core purpose.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-type-catalogue.md](../business-workshops/location-type-catalogue.md), specifically the section `Type model questions`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Depends on:** [TYPE-001 — Location Type Requirement and Ownership](type-001-location-type-requirement.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-TYPE-002, sourced from `Questions!47`.
- [docs/business-workshops/location-type-catalogue.md](../business-workshops/location-type-catalogue.md) — **Historical**; `Type model questions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
