# LOC-001: Operational Location Definition

- **Decision ID:** LOC-001
- **Workbook Decision ID:** DEC-LOC-001
- **Status:** Accepted
- **Date:** 2026-07-12T07:40:53.482Z
- **Decision owner:** Derek / Operations
- **Related domains:** Operational Location, Configuration, Service, Brand, Production

## Context

FIKA needs one durable way to identify every distinct place or operating context where it delivers work. The approved term is Operational Location, abbreviated OPLOC.

An OPLOC may exist for one day or for many years. Expected duration does not determine whether the operating context qualifies. Although FIKA overwhelmingly operates through repeat business, a one-off engagement may later become recurring, so returning to the same place must reuse the same OPLOC rather than create a new identity.

## Decision

An Operational Location is a site, venue or recurring operating context that FIKA works with over time. It provides a single durable identity that allows services, events, clients and operational history to be consistently associated with the same place, even if names, providers or individual services change.

## Business rationale

The OPLOC is the durable operational identity. It keeps FIKA's knowledge of where work is delivered connected even when the activity, capabilities, Client relationships, Services, classification or expected duration changes.

Reusing the same identity when FIKA returns protects continuity across operational history. Without it, repeat activity could be fragmented across records and teams could lose knowledge already gained about the operating environment.

## Positive consequences

- One stable OPLOC can connect operational knowledge across short-term and long-term work.

- FIKA can recognise repeat business and reuse knowledge instead of treating a returning location as entirely new.

- Changes to Clients, Services, capabilities or classification do not break the location's history.

- Operational reporting can follow the same place over time without relying on its current name or operating model.

## Trade-offs

- Teams must check for an existing OPLOC before creating a new one.

- A short engagement still requires a durable identity even when no future work is expected.

- Information that changes belongs in dated relationships or specialist domains rather than being overwritten on the OPLOC.

## Implementation implications

- Future domain models must give each OPLOC a stable identity that survives renames, reopening and changes in activity, Client relationships, capabilities, Services and classification.

- Workflows that create or mobilise an OPLOC must support duplicate checking and reuse of an existing OPLOC when FIKA returns.

- Historical operational knowledge must remain connected to the OPLOC while detailed records remain owned by their appropriate domains.

## Related decisions

- **Directly informs:** [LOC-002 — Operational Location Name](loc-002-operational-location-name.md)
- **Directly informs:** [LOC-003 — Operational Location Ownership Boundary](loc-003-operational-location-boundary.md)
- **Directly informs:** [LOC-004 — Operational Location Lifecycle](loc-004-operational-location-lifecycle.md)
- **Directly informs:** [TYPE-001 — Location Type Requirement and Ownership](type-001-location-type-requirement.md)
- **Directly informs:** [LOC-006 — Operational Location Building and Address Boundary](loc-006-single-building-address.md)
- **Directly informs:** [CFG-003 — Configuration Variation and Approval](cfg-003-configuration-variation-approval.md)
- **Directly informs:** [LOC-005 — Client and Operational Location Relationships](loc-005-client-operational-location-relationships.md)
- **Directly informs:** [SVC-004 — Service Arrangement Scope](svc-004-service-arrangement-scope.md)
- **Directly informs:** [BRAND-001 — Brand and White-Labelling Overrides](brand-001-brand-overrides.md)
- **Directly informs:** [TYPE-002 — Primary Location Type](type-002-primary-location-type.md)
- **Directly informs:** [TYPE-003 — Location Type History](type-003-location-type-history.md)
- **Directly informs:** [PROD-005 — Multi-Facility Production Routing](prod-005-multi-facility-production-routing.md)

Source traceability links retained for reversible Markdown reconstruction:

- [LOC-002](loc-002-operational-location-name.md)
- [LOC-003](loc-003-operational-location-boundary.md)
- [LOC-004](loc-004-operational-location-lifecycle.md)
- [TYPE-001](type-001-location-type-requirement.md)
- [LOC-006](loc-006-single-building-address.md)
- [CFG-003](cfg-003-configuration-variation-approval.md)
- [LOC-005](loc-005-client-operational-location-relationships.md)
- [SVC-004](svc-004-service-arrangement-scope.md)
- [BRAND-001](brand-001-brand-overrides.md)
- [TYPE-002](type-002-primary-location-type.md)
- [TYPE-003](type-003-location-type-history.md)
- [PROD-005](prod-005-multi-facility-production-routing.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-001, sourced from `Questions!3`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Decision 1: Canonical Location`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

- Stage 5 may define the minimum durable attributes and history required for an OPLOC without assuming that expected duration determines identity.

- Duplicate-detection and return-to-location workflows will need governed rules informed by real operational evidence.

- Future discovery should clarify how one-off operating contexts are found and reused when they later become recurring.
