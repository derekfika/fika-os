# BOOK-004: Immutable Pricing and Amendments

- **Decision ID:** BOOK-004
- **Workbook Decision ID:** DEC-BOOK-004
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Derek / Commercial / Finance
- **Related domains:** Booking, Production

## Context

Business discovery asked: **Should a submitted price snapshot remain immutable and be superseded by a governed amendment version?**

Before approval, the recorded evidence stated: “Submission-time snapshots are required; amendment versioning was unresolved at that point.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Keep accepted snapshots immutable; create an explicit amendment version for approved changes.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md), specifically the section `Minimum Decisions Required Before Schema Revision`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Booking.
- It directly enabled [PROD-004](prod-004-production-amendments-cancellations.md) to be decided on a stable basis.
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

- **Directly informs:** [PROD-004 — Production Amendments and Cancellations](prod-004-production-amendments-cancellations.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-BOOK-004, sourced from `Questions!12`.
- [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md) — **Supporting historical review**; `Minimum Decisions Required Before Schema Revision`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
