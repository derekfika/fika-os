# MOB-003: Mobilisation Readiness

- **Decision ID:** MOB-003
- **Workbook Decision ID:** DEC-MOB-003
- **Status:** Draft
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Operations / Client authority
- **Related domains:** Mobilisation, Roles and Permissions

## Context

Business discovery asked: **Who makes the opening-readiness decision, using which minimum evidence?**

Before approval, the recorded evidence stated: “Named launch authority and minimum evidence are not yet confirmed.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

The client determines the contractual go-live date, which FIKA treats as the operational target. Internal opening readiness is assessed by the Senior Management Team using agreed mobilisation evidence, with each domain confirming its own readiness before launch. Where significant operational risks remain, escalation and mitigation are required rather than delaying the agreed opening without client approval.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md), specifically the section `Dependencies and approval evidence`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Mobilisation.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Mobilisation artefacts must preserve the approved journey, stewardship, readiness and task-classification rules while leaving implementation design to later stages.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- **Depends on:** [MOB-001 — Canonical Mobilisation Journey](mob-001-mobilisation-journey.md)
- **Depends on:** [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-MOB-003, sourced from `Questions!30`.
- [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md) — **Supporting**; `Dependencies and approval evidence`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 7 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- Mobilisation is not necessarily Client-contractual.
- Client, contract and commercial-agreement references are optional and apply only where relevant.
- Internal Mobilisations, capability launches, remobilisations and material operating-model changes may have no Client basis.
- Readiness assessment authority follows explicit role assignments and AUTHMOD authority grants rather than management-group membership.
- No separate Client Mobilisation concept is introduced.
