# ROLE-007: Emergency Access

- **Decision ID:** ROLE-007
- **Workbook Decision ID:** DEC-ROLE-007
- **Status:** Staged for Review
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Derek / Security
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Is emergency access required, and who approves and audits it?**

Before approval, the recorded evidence stated: “No confirmed emergency-access policy is recorded.” The question was recorded as a follow-up decision with medium repository confidence before approval.

## Decision

Emergency access is a separately governed, temporary AUTHMOD authority grant used only where an immediate operational, security, safety or business-continuity need cannot be resolved through normal assignments and permission processes. It must not be inferred from job title, seniority, platform administration or existing technical access. Every emergency-access grant must identify the emergency, requester, authorised recipient, approving authority, controlled actions, governed scope, purpose, start time and mandatory fixed end time, and must be limited to the minimum access necessary. Where prior approval is genuinely impossible, a predefined break-glass rule may permit immediate activation only for specifically authorised roles, with automatic notification and mandatory retrospective approval and review. All activation, access, actions, data viewed or changed, approvals, notifications, expiry and revocation must be preserved in a tamper-evident audit history. Emergency access must expire automatically, may be revoked earlier, never transfers ownership and must not create permanent authority or routine access. Each use requires prompt independent review to confirm necessity, assess impact, identify misuse or control failure, and determine whether normal roles, permissions or processes require a separately governed change. Platform Governance implements and monitors the mechanism but does not grant emergency business authority unless explicitly authorised through AUTHMOD.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `G. Access principles`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Emergency access is a temporary assignment of exceptional technical authority; it does not transfer ownership or redefine normal approval rights. The [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) requires an accountable role, explicit authorisation, bounded scope and complete auditability. Platform Governance implements and reviews the mechanism but does not create business authority.

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

Emergency-access specifications must require an authorised role, reason, approving authority, minimum scope, start time, mandatory end time, revocation and complete activity history. Delegation must be fully auditable and must never transfer ownership.

## Related decisions

- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)
- **Depends on:** [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-007, sourced from `Questions!54`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `G. Access principles`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must confirm the role-based emergency authorisers, maximum durations, review timescales and retained audit evidence.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
