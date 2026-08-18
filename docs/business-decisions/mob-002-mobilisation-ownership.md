# MOB-002: Mobilisation Ownership

- **Decision ID:** MOB-002
- **Workbook Decision ID:** DEC-MOB-002
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Ed / Operations
- **Related domains:** Mobilisation, Roles and Permissions

## Context

Business discovery asked: **Who is process owner, coordinator and steward of the mobilisation journey?**

Before approval, the recorded evidence stated: “Ed's successful process does not prove permanent ownership.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

The Mobilisation journey is owned collectively by the Senior Management Team, reflecting FIKA's collaborative operating model. Individual mobilisations have a nominated coordinator responsible for day-to-day delivery, while specialist responsibilities are delegated across Operations, Culinary, Coffee, Marketing, Events and other domains as required. Overall stewardship remains with Senior Management to ensure consistent standards, accountability and successful site launches.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md), specifically the section `Mobilisation role map`. Without a canonical decision, later documents or applications could interpret this subject differently.

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

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-MOB-002, sourced from `Questions!29`.
- [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md) — **Supporting**; `Mobilisation role map`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 7 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- Each Mobilisation has one explicitly accountable organisational role for its governed scope.
- Seniority, job title or membership of a management group does not grant authority by itself.
- Additional approval, oversight, contribution or publication authority is represented through explicit role assignments and AUTHMOD authority grants.
- Defined responsibilities may be delegated for a recorded scope and effective period without transferring accountability.
- Collective stewardship does not create shared or unnamed ownership.
