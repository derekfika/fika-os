# CLIENT-001: Client and Client Contact Definition

- **Decision ID:** CLIENT-001
- **Workbook Decision ID:** DEC-CLIENT-001
- **Status:** Accepted
- **Date:** 2026-07-12T09:22:16.752Z
- **Decision owner:** Derek / Commercial
- **Related domains:** Client, Operational Location, Service

## Context

Business discovery asked: **What stable business concept should FikaClient represent, and what identity facts does it own?**

FIKA's long-term success depends on building and maintaining trusted relationships with external organisations and the people who represent them. These relationships help FIKA win tenders, retain contracts and respond to operational requests with as little friction as possible. During business discovery, the term "Client" was being used inconsistently to describe external organisations, individual contacts, Operational Locations and commercial relationships. In practice, a single Operational Location may involve several client layers. For example, CBRE may be the contracting organisation, Munich Re the occupier, and each organisation may have multiple individual contacts with different operational responsibilities. Without a canonical definition, different applications could model these concepts differently, leading to inconsistent relationships, duplicated data and loss of operational continuity. This decision establishes Client as a stable business concept before downstream domains are modelled.

## Decision

FikaClient represents an external organisation with which FIKA has a commercial or operational relationship. A Client owns its stable business identity, commercial relationship and shared business information independently of any individual Operational Location. Individual people within that organisation are represented separately as Client Contacts, allowing multiple contacts to fulfil operational, commercial or administrative responsibilities across one or more Operational Locations. An Operational Location may exist without an external Client but must always have an accountable internal owner.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/platform-domain-map.md](../platform-domain-map.md), specifically the section `Domain Catalogue — Client`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Client.
- It directly enabled [LOC-005](loc-005-client-operational-location-relationships.md), [SVC-004](svc-004-service-arrangement-scope.md) to be decided on a stable basis.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Client and Client Contact must remain separate concepts, and downstream records must preserve their approved relationships to Operational Locations.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Directly informs:** [LOC-005 — Client and Operational Location Relationships](loc-005-client-operational-location-relationships.md)
- **Directly informs:** [SVC-004 — Service Arrangement Scope](svc-004-service-arrangement-scope.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-CLIENT-001, sourced from `Questions!4`.
- [docs/platform-domain-map.md](../platform-domain-map.md) — **Canonical**; `Domain Catalogue — Client`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Repository History

//Context
Before approval, the recorded evidence stated: “Client is discovered above Operational Location; detailed discovery is missing.” The question was recorded as a foundation decision with low repository confidence before approval.

