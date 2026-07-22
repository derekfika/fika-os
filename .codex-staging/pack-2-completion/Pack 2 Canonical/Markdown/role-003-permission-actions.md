# ROLE-003: Permission Action Vocabulary

- **Decision ID:** ROLE-003
- **Workbook Decision ID:** DEC-ROLE-003
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Security / Domain owners
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Which actions—view, contribute, manage, approve, publish and administer—are required?**

Before approval, the recorded evidence stated: “A controlled action vocabulary is proposed but not final.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

AUTHMOD uses the controlled business-action vocabulary View, Contribute, Manage, Approve, Publish and Administer. View permits access to information within an authorised scope without changing it. Contribute permits creation or amendment of records within an authorised scope but does not confer approval, publication or administrative authority. Manage permits governed operational control, coordination and assignment within a defined domain and scope, but does not by itself permit approval or publication. Approve permits formal acceptance of a governed business action, exception or change where the role has explicit approval authority. Publish permits approved information or configuration to become visible, available or operationally active within its authorised audience and scope. Administer permits technical or configuration administration but does not confer ownership, operational, commercial, approval or publication authority. Every grant must combine an action with an explicit business scope, organisational role, effective period and audit history. Actions are granted through AUTHMOD according to business responsibility, separation of duties and least privilege; job titles, assignments, application access and technical privileges do not grant them implicitly.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `G. Access principles`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

An action describes what may be done; it does not establish who owns a business concept or holds authority to approve it. The [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) supplies authority through accountable roles or functions and time-bound assignments. Platform Governance enforces the vocabulary without redefining business authority.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Roles and Permissions.
- It directly enabled [ROLE-005](role-005-approval-publication-separation.md), [ROLE-006](role-006-access-boundaries.md), [ROLE-007](role-007-emergency-access.md) to be decided on a stable basis.
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

Permission specifications must combine the approved action vocabulary with a defined scope and authorised role assignment. Grants, changes and uses of elevated actions must be auditable; administration does not imply operational, commercial or publication authority.

## Related decisions

- **Depends on:** [ROLE-001 — Role Catalogue Ownership](role-001-role-catalogue-ownership.md)
- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)
- **Directly informs:** [ROLE-005 — Approval and Publication Separation](role-005-approval-publication-separation.md)
- **Directly informs:** [ROLE-006 — Access Boundaries](role-006-access-boundaries.md)
- **Directly informs:** [ROLE-007 — Emergency Access](role-007-emergency-access.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-003, sourced from `Questions!35`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `G. Access principles`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must define domain-specific permission mappings and review rules without adding new canonical actions silently.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
