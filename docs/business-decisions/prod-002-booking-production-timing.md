# PROD-002: Booking and Production Timing

- **Decision ID:** PROD-002
- **Workbook Decision ID:** DEC-PROD-002
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Production / Logistics
- **Related domains:** Production, Booking

## Context

Business discovery asked: **Which promised, service, preparation, dispatch and delivery times belong to Booking versus Production?**

Before approval, the recorded evidence stated: “Timing ownership needs clarification.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Booking owns the customer-facing service date and time, including when the customer expects delivery. Production owns all preparation, dispatch and production timing required to fulfil that commitment. Services produced centrally, including Delivered-In catering and Grab & Go, belong to the Production domain, while on-site preparation remains part of the operational workflow for that Operational Location.

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

- **Depends on:** [BOOK-001 — Booking Service Time](book-001-booking-service-time.md)
- **Depends on:** [PROD-001 — Production Order Eligibility](prod-001-production-order-eligibility.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-PROD-002, sourced from `Questions!32`.
- [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md) — **Supporting**; `Provisional domain boundary`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
