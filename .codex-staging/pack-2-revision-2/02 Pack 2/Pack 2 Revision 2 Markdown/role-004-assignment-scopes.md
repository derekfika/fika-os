# ROLE-004: Assignment Scopes

- **Decision ID:** ROLE-004
- **Workbook Decision ID:** DEC-ROLE-004
- **Status:** Staged for Review
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / HR / Domain owners
- **Related domains:** Roles and Permissions

## Context

Business discovery asked: **Which assignments may be company-wide, client-, location-, project-scoped or temporary?**

Before approval, the recorded evidence stated: “Scope and time-bound assignments recur across roles.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

An assignment links a named person to an organisational role, responsibility or governed business scope for an effective period. Assignments may apply organisation-wide or to one or more explicitly identified domains, clients, Operational Locations, Services, Service Arrangements, Events, mobilisations or other governed scopes. A person may hold multiple concurrent assignments where their scopes and responsibilities are compatible. An assignment does not by itself grant authority: any permitted actions must be granted separately through AUTHMOD for the applicable role, scope and effective period. Every assignment must record its assignee, assigned role or responsibility, scope, source, status, start date, approver and audit history. Temporary, cover and delegated assignments must also have a mandatory fixed end date; other assignments remain subject to effective dating, review and revocation. Expiry or revocation ends the person’s assignment without deleting the underlying role, responsibility or business ownership. Technical access must follow the approved assignment and authority grant and must not extend either.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md), specifically the section `Concept distinctions`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

Assignments let named people exercise authority that remains owned by an accountable organisational role or function under the [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md). Scope and duration limit that exercise; neither assignment nor technical access transfers business ownership.

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

Assignment specifications must record the authorised role, assignee, scope, start date, mandatory end date for temporary delegation, approval evidence and revocation history. Every delegation must be fully auditable and must never transfer ownership. Platform Governance implements these controls but does not define the authority assigned.

## Related decisions

- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-ROLE-004, sourced from `Questions!36`.
- [docs/domain-discovery/role-and-responsibility-discovery.md](../domain-discovery/role-and-responsibility-discovery.md) — **Supporting**; `Concept distinctions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

- [FIKA OS Authority Model](../fika-os-canon/04-authority-model.md) — **Canonical governance**; role-based authority, ownership, administration, delegation and platform-governance boundaries.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

Future work must confirm approval and review rules for each assignment scope without replacing role-based authority with named-person rules.

## Revision 2 governance note

This Revision 2 candidate applies the approved Governed Refactoring Register amendment. Ownership, authority and technical administration remain separate; AUTHMOD governs approved authority; Platform Governance implements approved controls and assesses impact without becoming business authority.
