# LOC-002: Operational Location Name

- **Decision ID:** LOC-002
- **Workbook Decision ID:** DEC-LOC-002
- **Status:** Accepted
- **Date:** 2026-07-12T08:31:57.824Z
- **Decision owner:** Derek
- **Related domains:** Operational Location

## Context

FIKA has used words such as site, venue and location in different operational contexts. A single umbrella term is required so that those narrower labels do not create competing identities for the same business concept.

## Decision

Operational Location (OPLOC)

## Business rationale

Site is too narrow because it implies an ongoing operating presence. Venue describes only one operating model, and Location alone is too generic to distinguish the business concept from an address or other place reference.

Operational Location accurately describes the durable identity of the place or operating context where FIKA works. OPLOC is the approved internal abbreviation.

## Positive consequences

- Teams have one precise umbrella term for every durable operating context.

- Site and Venue can remain meaningful Location Types without competing with the canonical identity.

- Internal documents and cross-application data can use OPLOC consistently.

- User-facing applications may use friendlier labels where appropriate without changing the underlying business meaning.

## Trade-offs

- FIKA must deliberately replace ambiguous uses of Location where the canonical concept is intended.

- User-facing labels may differ from canonical terminology, so documentation and mappings must keep the relationship clear.

- The Site and Venue catalogue still requires its own Type decisions and is not defined by this naming decision.

## Implementation implications

- Domain documentation and internal contracts should use Operational Location or OPLOC for the canonical concept.

- Applications may present context-appropriate labels, but they must map back to the same OPLOC identity and must not redefine Site or Venue as separate umbrella concepts.

## Related decisions

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-002, sourced from `Questions!15`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Decision 1: Canonical Location`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

- Future Type BDRs govern the definitions and lifecycle of Site and Venue.

- Terminology guidance may be needed for public-facing labels, translations and training while preserving Operational Location as the canonical business term.
