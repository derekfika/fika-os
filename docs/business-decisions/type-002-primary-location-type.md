# TYPE-002: Primary Location Type

- **Decision ID:** TYPE-002
- **Workbook Decision ID:** DEC-TYPE-002
- **Status:** Accepted
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Domain owners
- **Related domains:** Operational Location

## Context

Location Type describes an OPLOC's fundamental operating model. The catalogue must remain deliberately small and stable so that Type does not become a list of every Service, function or feature present at a location.

## Decision

Every Operational Location has one primary Location Type that defines its default operating model. Additional classifications may be applied where required for reporting or capability selection, but they must not replace the primary type or create ambiguity about the location's core purpose.

## Business rationale

Site and Venue are the current required Location Types. A Site is an OPLOC where FIKA maintains an ongoing operational presence, normally with regularly assigned Legends, ongoing responsibility, an established schedule and active Operational Capabilities. A till is not required; a dark kitchen with permanent Legends is still a Site.

A Venue is an OPLOC where FIKA delivers occasional or recurring work without maintaining an ongoing operational presence, normally using temporary or engagement-specific staffing, equipment or stock. A Venue can later become a Site without creating a new OPLOC.

New operational behaviour should normally be represented through Operational Capabilities, abbreviated OPCAPs. A new Type is justified only when the fundamental operating model cannot be represented accurately by an existing Type.

## Positive consequences

- Location Type remains a stable description of the operating model rather than proliferating with every capability.

- Site and Venue cover ongoing-presence and no-ongoing-presence models without relying on tills or individual Services.

- OPCAPs can describe what FIKA can do at an OPLOC while the Type remains stable.

- A Venue-to-Site transition preserves the same OPLOC identity.

## Trade-offs

- Type alone will not describe all Services, functions or compliance requirements at an OPLOC.

- The exact OPCAP catalogue requires separate governed decisions.

- Teams must distinguish a fundamental operating-model change from the addition or removal of a capability.

## Implementation implications

- Each OPLOC must expose one primary Location Type. Additional classifications mentioned by the locked Decision must not be used to create competing primary Types; operational behaviour should normally be represented through governed OPCAP assignments.

- CPU must not be introduced as a Location Type. A permanent dark kitchen or FIKAX remains a Site, with CPU represented as a future OPCAP candidate.

- Current examples support the distinction: Munich RE is a Site with Coffee Bar, Hospitality and Delivered-in Food capabilities; Optiver is a Site with Coffee Bar, Food Production and other applicable capabilities; FIKAX is a Site whose capabilities include front-of-house activity and CPU; Pimlico dark kitchen is a Site with CPU.

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

- The exact OPCAP catalogue requires its own future governed decisions and must not be fully defined through TYPE-002.

- Future Type proposals must demonstrate a genuinely different fundamental operating model that cannot be represented by Site or Venue plus OPCAPs.

- Food Production, Food Safety and CPU require separate domain-owner discovery before their capability rules become canonical.
