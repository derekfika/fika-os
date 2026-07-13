# PROD-001: Production Order Eligibility

- **Decision ID:** PROD-001
- **Workbook Decision ID:** DEC-PROD-001
- **Status:** Draft
- **Date:** 2026-07-12T08:34:36.344Z
- **Decision owner:** Derek / Production / Hospitality
- **Related domains:** Production, Booking

## Context

Business discovery asked: **Which booking states and conditions create, hold, amend or cancel a production order?**

Before approval, the recorded evidence stated: “Transformation eligibility and cancellation rules remain business decisions.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

A Production Order is created when a Booking reaches an approved state that commits FIKA to delivering food or drink requiring production. Bookings awaiting approval, quotation or customer confirmation must not generate Production Orders. Approved bookings may place Production Orders on hold until prerequisite conditions, such as menu confirmation or final numbers, are satisfied. Amendments to a confirmed booking must update the linked Production Order while preserving an audit history, and cancellations must cancel the Production Order only where production has not already commenced. Once production has started, any cancellation or amendment must be managed operationally rather than by deleting the original Production Order.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md), specifically the section `FikaBooking v1 Compatibility Review`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Production.
- It directly enabled [PROD-002](prod-002-booking-production-timing.md), [PROD-003](prod-003-production-units-yields.md), [PROD-004](prod-004-production-amendments-cancellations.md), [PROD-005](prod-005-multi-facility-production-routing.md) to be decided on a stable basis.
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

- **Depends on:** [BOOK-006 — Booking Amendments, Cancellations and Declines](book-006-booking-amendment-cancellation-decline.md)
- **Directly informs:** [PROD-002 — Booking and Production Timing](prod-002-booking-production-timing.md)
- **Directly informs:** [PROD-003 — Production Units, Yields and Aggregation](prod-003-production-units-yields.md)
- **Directly informs:** [PROD-004 — Production Amendments and Cancellations](prod-004-production-amendments-cancellations.md)
- **Directly informs:** [PROD-005 — Multi-Facility Production Routing](prod-005-multi-facility-production-routing.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-PROD-001, sourced from `Questions!31`.
- [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md) — **Supporting**; `FikaBooking v1 Compatibility Review`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
