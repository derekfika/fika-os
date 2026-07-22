# ROLE-006: Access Boundaries

- **Decision ID:** ROLE-006
- **Workbook Decision ID:** DEC-ROLE-006
- **Status:** Draft
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Derek / HR / Security / Data owner
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Which roles may access workforce, client, commercial, allergen, safety and audit detail or summaries?**

Before approval, the recorded evidence stated: “Sensitive-information boundaries remain unconfirmed.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Access to information within FIKA OS must follow the principle of least privilege and be granted according to business responsibility rather than job title. Site Managers may access workforce, client, operational, allergen, safety and audit information relating only to their own Operational Location. Domain Owners may access equivalent information across all Operational Locations within the domains they own, such as Coffee, Culinary, Events or Hospitality, without automatically gaining access to unrelated domains. Commercial, financial and workforce information must be restricted to authorised business owners. A limited number of Platform Administrators may hold full-system access for platform administration, support and recovery purposes, with all privileged access subject to comprehensive audit logging and periodic review.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `C. Provisional domain access needs`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Access is a technical expression of approved business responsibility, not evidence of ownership or approval authority. The [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) requires authority to remain role-based and assignments scoped and time-bound. Platform Governance administers and audits access without defining business authority.

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

Permission specifications must distinguish business ownership, approval authority and technical access. Grants, changes, privileged use, reviews and revocations must be fully auditable. Temporary access must have a mandatory end date and must not transfer ownership.

## Related decisions

- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)
- **Depends on:** [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-006, sourced from `Questions!38`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `C. Provisional domain access needs`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must define role-based access-review frequency, retention of audit evidence and the precise boundary of privileged platform administration.
