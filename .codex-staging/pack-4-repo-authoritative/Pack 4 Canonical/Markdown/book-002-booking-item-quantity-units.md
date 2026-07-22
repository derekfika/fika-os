# BOOK-002: Booking Item Quantities and Units

- **Decision ID:** BOOK-002
- **Workbook Decision ID:** DEC-BOOK-002
- **Status:** Draft
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Derek / Hospitality / Production
- **Related domains:** Booking, Production

## Context

Business discovery asked: **Which ordered quantity and unit fields must a canonical booking item carry for production compatibility?**

Before approval, the recorded evidence stated: “CPU evidence requires clearer production-compatible quantities and units.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

A canonical Booking Item must preserve both what the customer ordered and what Production must prepare. It must record the ordered quantity and ordered unit exactly as purchased (for example people, items, boxes, platters, packages or portions) together with any approved production conversion required to fulfil the order, such as serves-per-unit or pieces-per-person. This ensures Production can consistently calculate preparation quantities regardless of future menu, brochure or pricing changes. The definitive catalogue of supported units and conversion rules should be derived from FIKA's approved hospitality brochures and production processes.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md), specifically the section `Minimum Decisions Required Before Schema Revision`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Booking.
- It directly enabled [PROD-003](prod-003-production-units-yields.md) to be decided on a stable basis.
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

- **Directly informs:** [PROD-003 — Production Units, Yields and Aggregation](prod-003-production-units-yields.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-BOOK-002, sourced from `Questions!10`.
- [docs/schema-reviews/fika-booking-v1-review.md](../schema-reviews/fika-booking-v1-review.md) — **Supporting historical review**; `Minimum Decisions Required Before Schema Revision`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
