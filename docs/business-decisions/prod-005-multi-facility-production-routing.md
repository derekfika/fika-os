# PROD-005: Multi-Facility Production Routing

- **Decision ID:** PROD-005
- **Workbook Decision ID:** DEC-PROD-005
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Production / Logistics
- **Related domains:** Production, Operational Location

## Context

Business discovery asked: **May one booking create work at multiple facilities, and who owns routing?**

Before approval, the recorded evidence stated: “Future multi-facility routing is not confirmed.” The question was recorded as a follow-up decision with medium repository confidence before approval.

## Decision

A single Booking may generate Production work across multiple production facilities where operationally required. Production routing should be owned by the Production domain using defined routing rules, operational capacity and delivery requirements. Customers should place a single Booking without needing to understand how work is distributed internally.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md), specifically the section `Site and delivery-location handling`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Depends on:** [PROD-001 — Production Order Eligibility](prod-001-production-order-eligibility.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-PROD-005, sourced from `Questions!53`.
- [inventory/reports/cpu-production-dashboard.md](../../inventory/reports/cpu-production-dashboard.md) — **Supporting**; `Site and delivery-location handling`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
