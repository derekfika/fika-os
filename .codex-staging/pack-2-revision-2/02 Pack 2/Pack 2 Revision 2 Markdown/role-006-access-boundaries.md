# ROLE-006: Access Boundaries

- **Decision ID:** ROLE-006
- **Workbook Decision ID:** DEC-ROLE-006
- **Status:** Staged for Review
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Derek / HR / Security / Data owner
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Which roles may access workforce, client, commercial, allergen, safety and audit detail or summaries?**

Before approval, the recorded evidence stated: “Sensitive-information boundaries remain unconfirmed.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Access to information is granted through AUTHMOD according to explicit business purpose, controlled action, governed scope, information sensitivity and effective period, with least privilege as the default. Job title, assignment, ownership, application access or technical administration does not confer information access automatically. Each business domain owns the classification and permitted uses of its records, including whether a role may access full detail, restricted fields, summaries or aggregated outputs. Access may be scoped to identified domains, clients, Operational Locations, Services, Service Arrangements, Events or other governed business boundaries and must not extend to unrelated scopes. Workforce, commercial, financial, client, allergen, food-safety, safeguarding and audit information must receive controls appropriate to its sensitivity and lawful business use. Privileged technical access must be separately authorised, limited to the minimum purpose and duration required, and must not confer business ownership, operational authority or unrestricted routine visibility. Every access grant, change, use of privileged access, review, expiry and revocation must be auditable. Temporary or exceptional access must have a fixed end date; emergency access is additionally governed by ROLE-007. Platform Governance implements and monitors approved controls but does not define business access entitlement unless separately authorised through AUTHMOD.

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

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
