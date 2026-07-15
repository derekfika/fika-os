# SVC-006 — Scheduled Work and Booking Boundary

- **Decision ID:** SVC-006
- **Workbook Decision ID:** DEC-SVC-006
- **Status:** Accepted
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Role-based authority via AUTHMOD / Operations / Hospitality
- **Related domains:** Service

## Context

Business discovery asked: **When does a dated occurrence require a Booking, and when may it exist without one?**

Before approval, the recorded evidence stated: “A Wise delivery must not automatically be classified as a Booking.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

A Hospitality Booking is an independent request for hospitality work against an available Service Arrangement. It does not depend on, attach to or create a Service Occurrence. Recurring Schedules define repeating planned work, while Hospitality Bookings and similar operational requests provide separate demand inputs into a shared fulfilment workflow. The shared workflow must preserve each input's business classification, source, requested date and time, quantities, destination, status and audit history. Routine operating availability, such as Munich RE coffee-bar opening hours, remains configuration or scheduling information and is not itself a Booking or work record.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `C. Service versus booking`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It provides stable business meaning for later BDR, schema and architecture work.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Service models must preserve the approved distinctions among Service Arrangement, Recurring Schedule, retired dated-occurrence concept, Booking and related domains.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [SVC-002 — Service Terminology](svc-002-service-terminology.md)
- **Depends on:** [SVC-005 — Recurring Schedule Governance](svc-005-recurring-schedule-governance.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-006, sourced from `Questions!42`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `C. Service versus booking`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed explanatory refinements

- Replace the Munich RE example with a clear distinction between operating hours and generated operational work.
- Use Angel Court milk delivery as the recurring-work example.
- Use a one-off Angel Court sandwich request as the Hospitality Booking example.
- Remove every reference to retired dated-occurrence concept from context, consequences, implementation implications, related decisions and filename.
- Preserve Event as the established FIKA business concept; do not use it as technical messaging terminology.

## Governed follow-up

- Confirm the canonical name of the shared fulfilment record or work concept in later discovery; do not assume Work Item is adopted yet.
- Confirm whether other request types beyond Hospitality Booking and Recurring Schedule may use the same fulfilment workflow.
Ready for export: Yes
---
