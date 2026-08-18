# ROLE-001 — Role Catalogue Ownership

- **Decision ID:** ROLE-001
- **Workbook Decision ID:** DEC-ROLE-001
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Derek / Security / Domain owners
- **Related domains:** Roles and Permissions, Events

## Context

Business discovery asked: **Who owns the platform-role catalogue and controlled permission-action vocabulary?**

Before approval, the recorded evidence stated: “Jobs, roles, responsibilities, assignments and approvals are separated; ownership is unconfirmed.” The question was recorded as a foundation decision with low repository confidence before approval.

## Decision

Operations Leadership owns the organisation-wide business Role Catalogue and is accountable for ensuring that organisational roles remain coherent, purposeful and aligned with FIKA’s operating model. Each business domain owns the responsibilities and domain-specific authority requirements associated with its work. AUTHMOD owns the governed authority model, including the controlled permission-action vocabulary, scopes, separation-of-duties rules and delegation constraints used to grant authority to organisational roles. Authority is granted to roles, not inferred from job titles, individuals, applications or technical access. Platform Governance maintains the technical representation, validates cross-domain consistency and implements approved changes, but does not create business roles or grant business authority unless separately authorised through AUTHMOD. All catalogue and authority-model changes must identify their accountable owner, approver, effective date, reason and audit history.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `A. Plain-English role model`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Roles and Permissions.

It directly enabled [ROLE-002](role-002-roles-responsibilities-assignments.md), [EVT-002](evt-002-event-governance.md), [ROLE-003](role-003-permission-actions.md) to be decided on a stable basis.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Permission and assignment design must preserve the approved vocabulary, scopes, separation of duties, least-privilege boundaries and audit expectations.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Directly informs:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)
- **Directly informs:** [EVT-002 — Event Governance](evt-002-event-governance.md)
- **Directly informs:** [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-001, sourced from `Questions!7`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `A. Plain-English role model`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
