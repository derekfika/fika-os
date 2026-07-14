# LOC-006: Operational Location Building and Address Boundary

- **Decision ID:** LOC-006
- **Workbook Decision ID:** DEC-LOC-006
- **Status:** Accepted
- **Date:** 2026-07-12T08:32:47.310Z
- **Decision owner:** Derek / Operations
- **Related domains:** Operational Location

## Context

Postal addresses and building boundaries do not always match the way FIKA operates. The OPLOC boundary must reflect whether FIKA manages operating environments together or independently.

## Decision

A canonical Operational Location represents a single physical operating location. It should not span multiple buildings or addresses. Where a client operates across multiple sites, each site should have its own Operational Location with its own operational history, while the shared commercial relationship is represented by the Client domain. This keeps operational management, reporting, staffing, equipment and hospitality independent while allowing multiple locations to belong to the same client.

## Business rationale

The operational test is: would FIKA manage, staff, equip, deliver to, order for, mobilise or account for the operating environments independently? If yes, they should normally be separate OPLOCs.

Different buildings that require separate staffing, equipment, deliveries or supplier ordering are separate OPLOCs. Several floors or service points may remain one OPLOC when they form one managed operating environment.

Commercial relationships may connect locations; operational management determines whether they are separate OPLOCs.

## Positive consequences

- OPLOC boundaries reflect real operational responsibility rather than relying only on postal addresses.

- Staffing, equipment, deliveries, supplier ordering, mobilisation and reporting can follow independently managed environments.

- One Client can connect several OPLOCs without collapsing their operational identities.

- Future commercial records can span multiple OPLOCs while each location retains its own history.

## Trade-offs

- Judgement is required where a building contains several service points or operating environments.

- A single address may contain more than one OPLOC, while several floors may form one OPLOC.

- Commercial scope alone cannot decide whether operational environments are one location.

## Implementation implications

- OPLOC creation and boundary-review workflows must apply the operational-management test and retain the evidence used.

- Commercial Agreement (COMAG) is a high-priority discovery candidate that may cover one or more OPLOCs and may eventually own commercial scope, billing rules, contract dates, renewals, commercial reporting, profitability, SLAs and related terms. It must not enter Pack 1 schemas without an approved BDR.

- OPLOC Group remains parked because no current FIKA requirement justifies a non-commercial grouping object.

## Related decisions

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-006, sourced from `Questions!19`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Decision 1: Canonical Location`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

- Future COMAG discovery should determine whether it provides the commercial anchor for multiple OPLOCs without owning their operational identities.

- OPLOC Group should be reconsidered only if a real non-commercial grouping requirement emerges that Client or COMAG cannot satisfy.

- Stage 5 should avoid reducing the OPLOC boundary to one-address or one-building validation.
