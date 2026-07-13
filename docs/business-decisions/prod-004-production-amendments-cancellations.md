# PROD-004: Production Amendments and Cancellations

- **Decision ID:** PROD-004
- **Workbook Decision ID:** DEC-PROD-004
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Production / Hospitality
- **Related domains:** Production, Booking

## Context

Business discovery asked: **How should late booking amendments and cancellations affect created production work and audit history?**

Before approval, the recorded evidence stated: “Current paths risk ambiguity and partial processing.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Late booking amendments and cancellations must never overwrite or delete production work or audit history. All changes should preserve a complete record of what was originally requested, what changed, who approved the change and when it occurred. Where production has not yet begun, Production Orders should be updated or cancelled automatically. Once production has started, amendments and cancellations should generate operational notifications and require human review to determine the appropriate action, ensuring food preparation, waste, commercial impact and customer commitments are managed without losing historical accuracy.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md), specifically the section `Cancellations and amendments`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

- **Depends on:** [BOOK-004 — Immutable Pricing and Amendments](book-004-immutable-pricing-amendments.md)
- **Depends on:** [BOOK-006 — Booking Amendments, Cancellations and Declines](book-006-booking-amendment-cancellation-decline.md)
- **Depends on:** [PROD-001 — Production Order Eligibility](prod-001-production-order-eligibility.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-PROD-004, sourced from `Questions!34`.
- [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md) — **Supporting**; `Cancellations and amendments`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
