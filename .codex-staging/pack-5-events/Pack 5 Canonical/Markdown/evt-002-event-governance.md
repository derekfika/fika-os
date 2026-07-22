# EVT-002: Event Governance

- **Decision ID:** EVT-002
- **Workbook Decision ID:** DEC-EVT-002
- **Status:** Draft
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / Events owner
- **Related domains:** Events, Roles and Permissions

## Context

Business discovery asked: **Who owns Event lifecycle, status, qualification and publication approvals?**

Before approval, the recorded evidence stated: “Delegation, quote approval and publication authority are open.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

The Events Lead approves bespoke events, with the Site Manager approving where appropriate. Qualification follows the canonical Event definition. Lifecycle statuses and publication approval still require separate confirmation.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `Candidate platform roles — Events`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Events.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Event records and workflows must preserve the approved boundary between Event, Service Occurrence and Booking and must respect the stated approval ownership.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [EVT-001 — Event Qualification Boundary](evt-001-event-qualification.md)
- **Depends on:** [ROLE-001 — Role Catalogue Ownership](role-001-role-catalogue-ownership.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-EVT-002, sourced from `Questions!27`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `Candidate platform roles — Events`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 5 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- Every canonical Event has an auditable approval record.
- The approval record identifies the approving person, approving organisational role or delegated authority, approval decision, approval timestamp and approval conditions where applicable.
- No separate Governance Evidence concept is introduced at this stage.
- Approval thresholds, notification thresholds, escalation rules and additional evidence requirements remain deferred to future governance policy.
