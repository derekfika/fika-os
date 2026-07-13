# LOC-003: Operational Location Ownership Boundary

- **Decision ID:** LOC-003
- **Workbook Decision ID:** DEC-LOC-003
- **Status:** Draft
- **Date:** 2026-07-12T08:31:57.824Z
- **Decision owner:** Derek / Operations / Domain owners
- **Related domains:** Operational Location

## Context

Business discovery asked: **Which durable facts belong to canonical location, and which explicitly do not?**

Before approval, the recorded evidence stated: “Identity, name, aliases and lifecycle are proposed; client, brand, address and providers are separate.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

A canonical Operational Location owns only the durable facts that define the long-term identity of a place FIKA operates within, including its approved name, historical aliases, lifecycle, stable identity and durable relationships with other business objects. It does not own provider integrations, application configuration, branding, physical address master data, menus, pricing, equipment inventory, staffing, calendars, bookings, events, services or other operational records that belong to their own business domains. The Operational Location provides the permanent business anchor to which those domains relate, rather than containing or controlling them.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md), specifically the section `Candidate responsibility boundary`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-003, sourced from `Questions!16`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Candidate responsibility boundary`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
