# ROLE-002: Roles, Responsibilities, Assignments and Authority

- **Decision ID:** ROLE-002
- **Workbook Decision ID:** DEC-ROLE-002
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / HR / Security
- **Related domains:** Roles and Permissions, Mobilisation

## Context

Business discovery asked: **What is the relationship between job titles, roles, responsibilities, assignments and approval authority?**

Before approval, the recorded evidence stated: “The concepts are separated and assignments proposed as time-bound, but not approved.” The question was recorded as a foundation decision with medium repository confidence before approval.

## Decision

Job title, organisational role, responsibility, assignment and authority are separate governed concepts. A job title describes a person’s employment position and does not by itself grant authority. An organisational role defines a durable business purpose and set of responsibilities. A responsibility states work or accountability owned by a role or business domain. An assignment links a named person to a role, responsibility or governed scope for an effective period and does not transfer ownership. Authority is granted separately through AUTHMOD as explicit, scoped permission to perform defined actions. Assignments and authority grants must be effective-dated, auditable and revocable. Temporary delegation must have a fixed end date and never changes the underlying role, responsibility or business ownership. Applications and technical access enforce approved assignments and authority but do not create them.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `A. Plain-English role model`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

The [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) makes the separation operational: authority belongs to an accountable role or function, while a named person receives a time-bound assignment to exercise it. Business ownership remains distinct from both the assignment and the technical mechanism that enforces it.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Roles and Permissions.
- It directly enabled [MOB-002](mob-002-mobilisation-ownership.md), [MOB-003](mob-003-mobilisation-readiness.md), [ROLE-003](role-003-permission-actions.md), [ROLE-004](role-004-assignment-scopes.md), [ROLE-005](role-005-approval-publication-separation.md), [ROLE-006](role-006-access-boundaries.md), [ROLE-007](role-007-emergency-access.md) to be decided on a stable basis.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

- Ownership, authority and technical administration are now explicitly separated and traceable.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

- Role-based approval, audit history and time limits add governance effort but prevent technical or temporary access from becoming permanent business authority.

## Implementation implications

Permission and assignment design must preserve the approved vocabulary, scopes, separation of duties, least-privilege boundaries and audit expectations.

This BDR does not select a database, API, provider, application design or deployment approach.

Permission and assignment specifications must preserve the approved distinctions. Temporary delegation must have a mandatory end date, be fully auditable and never transfer ownership. Platform Governance implements approved assignments and controls but does not define business authority.

## Related decisions

- **Depends on:** [ROLE-001 — Role Catalogue Ownership](role-001-role-catalogue-ownership.md)
- **Directly informs:** [MOB-002 — Mobilisation Ownership](mob-002-mobilisation-ownership.md)
- **Directly informs:** [MOB-003 — Mobilisation Readiness](mob-003-mobilisation-readiness.md)
- **Directly informs:** [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md)
- **Directly informs:** [ROLE-004 — Assignment Scopes](role-004-assignment-scopes.md)
- **Directly informs:** [ROLE-005 — Approval and Publication Separation](role-005-approval-publication-separation.md)
- **Directly informs:** [ROLE-006 — Access Boundaries](role-006-access-boundaries.md)
- **Directly informs:** [ROLE-007 — Emergency Access](role-007-emergency-access.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-002, sourced from `Questions!22`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `A. Plain-English role model`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must define the approved role catalogue and assignment evidence without collapsing jobs, roles, responsibilities, scopes or authority into one record.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
