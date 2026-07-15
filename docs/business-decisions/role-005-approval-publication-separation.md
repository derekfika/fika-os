# ROLE-005: Approval and Publication Separation

- **Decision ID:** ROLE-005
- **Workbook Decision ID:** DEC-ROLE-005
- **Status:** Draft
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Derek / Security / Domain owners
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Which decisions separate contributor, manager, approver and publisher?**

Before approval, the recorded evidence stated: “Approval responsibilities are not yet confirmed across domains.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Contribute, Manage, Approve and Publish are separate AUTHMOD actions and no action includes another implicitly. Contribute permits authorised creation or amendment of business records. Manage permits authorised coordination, assignment and routine operational control. Approve records formal acceptance of a governed business decision, exception, change or output by a role holding explicit approval authority for the applicable domain and scope. Publish makes approved information, configuration, Service or other governed output visible, available or operationally active for an authorised audience and scope. Publication must not occur without the required approval, but approval does not itself publish. The same assigned person may perform more than one action only where AUTHMOD explicitly grants each action and the owning domain permits that combination under its separation-of-duties rules. High-risk or material decisions may require different approver and publisher assignments or multiple approvals. Every approval and publication must record the action, subject, scope, actor, authority source, decision or outcome, effective time and audit history. Delegation must be scoped, auditable and time-limited and never transfers ownership. Platform Governance implements and validates the workflow controls but does not supply business approval or publication authority unless separately granted through AUTHMOD.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `G. Access principles`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Approval authority belongs to an accountable business role or function; publication is a separate action that activates approved content. The [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) keeps both distinct from technical administration. Platform Governance implements controls but does not decide business approval.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Roles and Permissions.
- It provides stable business meaning for later BDR, schema and architecture work.
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

Workflow and permission specifications must record contribution, management, approval and publication as distinct actions even where one authorised assignee performs more than one. Temporary delegation must have a mandatory end date, be fully auditable and never transfer ownership.

## Related decisions

- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)
- **Depends on:** [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-005, sourced from `Questions!37`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `G. Access principles`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must define which accountable roles may approve and publish within each domain and when separation of duties is mandatory.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
