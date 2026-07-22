# BOOK-006 — Booking Amendments, Cancellations and Declines

## Metadata

- Decision ID: BOOK-006
- Workbook Decision ID: DEC-BOOK-006
- Current Status: Draft
- Date: 2026-07-12T08:31:57.824Z
- Decision Owner: Derek / Hospitality / Commercial
- Related Domains: Booking, Production
- Repository File: docs/business-decisions/book-006-booking-amendment-cancellation-decline.md
- Schema Pack: Pack 4
- Review Status: Not Reviewed

> The Decision section is canonical and locked. Do not edit it.

## Context

Business discovery asked: **Which status transitions and permissions govern amendments, cancellations and declines?**

Before approval, the recorded evidence stated: “Commercial status is separate from workflow state; mutation authority was unresolved at that point.” The question was recorded as a refinement decision with low repository confidence before approval.

Decision — Canonical and Locked

> The Decision section is canonical and locked. Do not edit it.

A booking may be amended, cancelled or declined only while it remains under the responsibility of the appropriate business owner. Amendments should preserve a complete audit history rather than overwrite previous information. Cancellations must record the reason and retain the original booking for reporting and audit purposes. Declined bookings should only occur where the request cannot reasonably be fulfilled due to operational, commercial or customer requirements, with the reason recorded. Permissions to amend, cancel or decline a booking must follow role-based responsibilities and approval authority, with higher-risk changes requiring the appropriate operational approval.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md), specifically the section `Minimum Decisions Required Before Schema Revision`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Booking.

It directly enabled [PROD-001](prod-001-production-order-eligibility.md), [PROD-004](prod-004-production-amendments-cancellations.md) to be decided on a stable basis.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

The Stage 5 Booking revision must implement this decision and preserve its audit, amendment, commercial or provenance consequences without importing application-specific fields.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

**Directly informs:** [PROD-001 — Production Order Eligibility](prod-001-production-order-eligibility.md)

**Directly informs:** [PROD-004 — Production Amendments and Cancellations](prod-004-production-amendments-cancellations.md)

## Evidence

[FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-BOOK-006, sourced from `Questions!14`.

[docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md) — **Supporting historical review**; `Minimum Decisions Required Before Schema Revision`.

[Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.

[Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

Supersedes / Superseded by

**Supersedes:** None

**Superseded by:** None

Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

Review Notes

Questions for Derek:

Business corrections required:

Reviewer comments:

Final approval:

Approval date:
