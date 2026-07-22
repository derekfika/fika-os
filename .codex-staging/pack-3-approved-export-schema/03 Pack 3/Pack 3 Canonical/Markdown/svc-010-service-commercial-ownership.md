# SVC-010 — Service Commercial Ownership

- **Decision ID:** SVC-010
- **Workbook Decision ID:** DEC-SVC-010
- **Status:** Accepted
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Role-based authority via AUTHMOD / Commercial / Service owners
- **Related domains:** Service, Configuration

## Context

Business discovery asked: **Who owns menus, packages, pricing and effective dates for each service arrangement?**

Before approval, the recorded evidence stated: “Commercial and catalogue ownership was repeatedly not yet confirmed.” The question was recorded as a refinement decision with low repository confidence before approval.

## Decision

Commercial ownership of each Service and Service Arrangement is assigned to an authorised business role through AUTHMOD rather than to a named individual. The accountable senior role owns the commercial framework, including approved menus, packages, pricing principles and effective-date governance. Defined responsibilities may be delegated to authorised operational or specialist roles within a governed scope and for a recorded period, without transferring ultimate ownership. Every commercial change must identify its owner, approver, effective date, scope, reason and audit history. Different Service domains may assign different accountable and delegated roles while following the same governance model.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md), specifically the section `G. Client and commercial relationships`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

FIKA now has a stable, human-approved rule for this aspect of Service.

It provides stable business meaning for later BDR, schema and architecture work.

Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.

Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

The decision constrains local interpretation where consistency is required.

Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.

The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Service models must preserve the approved distinctions among Service Arrangement, Recurring Schedule, retired dated-occurrence concept, Booking and related domains.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [SVC-001 — Service Definition](svc-001-service-definition.md)
- **Depends on:** [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md)
## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-SVC-010, sourced from `Questions!44`.
- [docs/domain-discovery/service-domain-discovery.md](../domain-discovery/service-domain-discovery.md) — **Supporting**; `G. Client and commercial relationships`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.
## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None
## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Governed amendment rationale

- The current Decision names Sam and Brian directly, making business authority dependent on current postholders.
- The BDR must govern roles and authority, not individuals.
- Ownership and delegated responsibility must remain distinct.
- Delegation must be scoped, recorded and auditable and must not transfer ultimate ownership.
- Menus, packages, pricing and effective dates may have different operational contributors but require one accountable commercial authority for the governed scope.

## Governed explanatory refinements

- Replace named Decision ownership with role-based business ownership governed through AUTHMOD.
- Use the current Culinary Director and Project Chef arrangement only as an explanatory example, not as canonical identity.
- Clarify that the accountable senior role may delegate defined responsibilities while retaining ownership.
- Require effective dating, approval, version history and auditability for commercial changes.
- Remove retired dated-occurrence concept from implementation implications.
- Distinguish Service-level commercial standards from OPLOC-specific Service Arrangement configuration.

## Governed follow-up

- Confirm the canonical role or authority domain that owns the commercial framework for food Services; do not assume one role owns every Service domain.
- Confirm which changes require central approval and which may be delegated locally through AUTHMOD.
- Later schema work must distinguish accountable owner, delegated contributor, approver and effective-dated commercial configuration.
Ready for export: Yes
---
