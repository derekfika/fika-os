# ROLE-007: Emergency Access

- **Decision ID:** ROLE-007
- **Workbook Decision ID:** DEC-ROLE-007
- **Status:** Draft
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Derek / Security
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Is emergency access required, and who approves and audits it?**

Before approval, the recorded evidence stated: “No confirmed emergency-access policy is recorded.” The question was recorded as a follow-up decision with medium repository confidence before approval.

## Decision

FIKA OS must support emergency access for exceptional operational, security or business continuity situations where normal permissions would prevent an urgent response. Emergency access should be granted only to authorised Platform Administrators or designated senior personnel, require a documented reason, and be limited to the minimum scope and duration necessary. Every emergency access session must generate a complete audit record showing who requested access, who authorised it, what information or actions were accessed, when access occurred and when it was revoked. Emergency access must never become a substitute for normal role assignments or permission management and should be reviewed after each use to identify whether permanent permission changes or process improvements are required.

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
