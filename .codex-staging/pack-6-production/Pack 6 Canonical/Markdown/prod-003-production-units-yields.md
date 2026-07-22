# PROD-003: Production Units, Yields and Aggregation

- **Decision ID:** PROD-003
- **Workbook Decision ID:** DEC-PROD-003
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Production
- **Related domains:** Production, Booking

## Context

Business discovery asked: **Which production units, conversions, yields and aggregation rules belong to Production?**

Before approval, the recorded evidence stated: “Ordered quantities belong in Booking; conversions and yields are Production concerns.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Booking records what the customer ordered, while Production owns how that order is fulfilled. Production therefore owns preparation units, yields, recipe conversions, batch calculations and aggregation rules required to manufacture the order efficiently. These rules must be independent of how the customer originally placed the order, allowing Production to optimise preparation without altering the commercial booking.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md), specifically the section `Provisional domain boundary`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Production.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Production models and workflows must remain separate from Booking commercial intent while preserving the approved eligibility, timing, units, routing and amendment rules.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [BOOK-002 — Booking Item Quantities and Units](book-002-booking-item-quantity-units.md)
- **Depends on:** [PROD-001 — Production Order Eligibility](prod-001-production-order-eligibility.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-PROD-003, sourced from `Questions!33`.
- [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md) — **Supporting**; `Provisional domain boundary`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 6 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- Production Line ownership is assigned through organisational roles under the Authority Model.
- Ownership may differ between Production Lines within one Production Order where the operational context requires it.
- Ownership is not fixed to a department.
