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

FIKA OS should use a consistent set of business actions across every domain: View, Contribute, Manage, Approve, Publish and Administer. View allows read-only access to relevant information. Contribute allows users to create or edit records they own or are responsible for. Manage allows operational control, assignment and routine decision-making within a domain. Approve grants formal authority to accept significant business actions, exceptions or changes. Publish makes approved information visible or operationally active to the wider business or customers. Administer governs platform configuration, roles and permissions but does not automatically grant operational or commercial authority. Each action should be granted according to business responsibility rather than job title, with least-privilege access as the default.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `G. Access principles`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Roles and Permissions.
- It directly enabled [ROLE-005](role-005-approval-publication-separation.md), [ROLE-006](role-006-access-boundaries.md), [ROLE-007](role-007-emergency-access.md) to be decided on a stable basis.
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
- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)
- **Directly informs:** [ROLE-005 — Approval and Publication Separation](role-005-approval-publication-separation.md)
- **Directly informs:** [ROLE-006 — Access Boundaries](role-006-access-boundaries.md)
- **Directly informs:** [ROLE-007 — Emergency Access](role-007-emergency-access.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-003, sourced from `Questions!35`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `G. Access principles`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.
