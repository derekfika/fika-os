# LOC-005: Client and Operational Location Relationships

- **Decision ID:** LOC-005
- **Workbook Decision ID:** DEC-LOC-005
- **Status:** Accepted
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Commercial
- **Related domains:** Operational Location, Client

## Context

FIKA needs to distinguish the place where it operates from the organisations and people it works with. Client, Client Contact and OPLOC identities can each persist while their relationships change.

## Decision

A Client may relate to multiple Operational Locations, and those relationships may change over time. An Operational Location normally has one primary commercial Client at any given time, but it may also have multiple operational contacts or stakeholder organisations responsible for the day-to-day running of the location. These operational relationships should be modelled separately from the primary commercial client relationship to avoid ambiguity while preserving historical changes over time.

## Business rationale

A Client is an organisation and a Client Contact is an individual associated with that organisation. An OPLOC answers where FIKA operates; Client concepts answer who FIKA works with.

One Client may relate to many OPLOCs, and one OPLOC may involve multiple Client organisations and Client Contacts. A Client change therefore does not create a new OPLOC, and historical relationships must remain traceable.

## Positive consequences

- Client and OPLOC identities remain independent and reusable.

- Changes in contracting, occupying or stakeholder organisations do not fragment location history.

- FIKA can trace which organisations and contacts were involved at different times.

- The model can support several Client layers around one OPLOC without treating them as the place itself.

## Trade-offs

- The relationship between a Client and an OPLOC needs its own dates, role and provenance rather than being reduced to one current Client field.

- Contact responsibility and communication practices cannot safely be inferred from Client identity alone.

- A richer relationship concept may be required, but it is not yet approved as a canonical Pack 1 object.

## Implementation implications

- Future schemas must keep Client, Client Contact and OPLOC as separate identities connected through historically traceable relationships.

- OPLOC creation and maintenance must not duplicate Client or Client Contact master data.

- Operational Relationship (OPREL) is recorded only as a high-priority discovery candidate. It must not enter Pack 1 schemas without a future approved BDR.

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

- Future discovery should test OPREL as a possible description of how FIKA works with a Client organisation and its Client Contacts in a particular operational context.

- Candidate OPREL concerns include communication method, meeting cadence, responsibilities, reporting expectations, escalation routes, approvals, relationship ownership and active dates. These are provisional and non-canonical.
