# ROLE-002: Roles, Responsibilities, Assignments and Authority

- **Decision ID:** ROLE-002
- **Workbook Decision ID:** DEC-ROLE-002
- **Status:** Draft
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / HR / Security
- **Related domains:** Roles and Permissions, Mobilisation

## Context

Business discovery asked: **What is the relationship between job titles, roles, responsibilities, assignments and approval authority?**

Before approval, the recorded evidence stated: “The concepts are separated and assignments proposed as time-bound, but not approved.” The question was recorded as a foundation decision with medium repository confidence before approval.

## Decision

Keep job title, role, responsibility, assignment scope and approval authority distinct.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `A. Plain-English role model`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Roles and Permissions.
- It directly enabled [MOB-002](mob-002-mobilisation-ownership.md), [MOB-003](mob-003-mobilisation-readiness.md), [ROLE-003](role-003-permission-actions.md), [ROLE-004](role-004-assignment-scopes.md), [ROLE-005](role-005-approval-publication-separation.md), [ROLE-006](role-006-access-boundaries.md), [ROLE-007](role-007-emergency-access.md) to be decided on a stable basis.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Permission and assignment design must preserve the approved vocabulary, scopes, separation of duties, least-privilege boundaries and audit expectations.

This BDR does not select a database, API, provider, application design or deployment approach.

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

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
