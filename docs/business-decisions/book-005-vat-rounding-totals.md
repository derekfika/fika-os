# BOOK-005: VAT, Rounding and Totals

- **Decision ID:** BOOK-005
- **Workbook Decision ID:** DEC-BOOK-005
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Derek / Finance
- **Related domains:** Booking

## Context

Business discovery asked: **What VAT, tax-rounding and total-reconciliation policy must canonical bookings follow?**

Before approval, the recorded evidence stated: “Tax and rounding policy is a business/finance decision.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

All pricing is ex-vat and vat is calculated at the end of the quote. Round up is preferred.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md), specifically the section `Minimum Decisions Required Before Schema Revision`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Booking.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

The Stage 5 Booking revision must implement this decision and preserve its audit, amendment, commercial or provenance consequences without importing application-specific fields.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- None — this is a foundational decision with no direct workbook dependency.

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-BOOK-005, sourced from `Questions!13`.
- [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md) — **Supporting historical review**; `Minimum Decisions Required Before Schema Revision`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
