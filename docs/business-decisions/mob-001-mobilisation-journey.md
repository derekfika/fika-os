# MOB-001: Canonical Mobilisation Journey

- **Decision ID:** MOB-001
- **Workbook Decision ID:** DEC-MOB-001
- **Status:** Accepted
- **Status history:** Pack approval was complete; Draft metadata corrected to Accepted on 2026-07-28 by explicit owner instruction. Decision wording is unchanged.
- **Date:** 2026-07-12T08:13:46.942Z
- **Decision owner:** Derek / Mobilisation owner
- **Related domains:** Mobilisation

## Context

Business discovery asked: **Which phases, task families and dependency patterns are stable enough to define the canonical mobilisation journey?**

Before approval, the recorded evidence stated: “MNK evidences recurring phases and dependencies, but their reusable boundary is not approved.” The question was recorded as a foundation decision with medium repository confidence before approval.

## Decision

Use evidenced MNK phases as a workshop baseline and mark optional work explicitly.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md), specifically the section `Journey from contract award to launch`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Mobilisation.
- It directly enabled [MOB-002](mob-002-mobilisation-ownership.md), [MOB-003](mob-003-mobilisation-readiness.md), [MOB-004](mob-004-mobilisation-task-classification.md) to be decided on a stable basis.
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

- **Directly informs:** [MOB-002 — Mobilisation Ownership](mob-002-mobilisation-ownership.md)
- **Directly informs:** [MOB-003 — Mobilisation Readiness](mob-003-mobilisation-readiness.md)
- **Directly informs:** [MOB-004 — Mobilisation Task Classification](mob-004-mobilisation-task-classification.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-MOB-001, sourced from `Questions!6`.
- [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md) — **Supporting**; `Journey from contract award to launch`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 7 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- A Mobilisation is one governed programme that establishes, materially changes or re-establishes an Operational Location, Service Arrangement, Operational Capability or other approved operating scope.
- One Operational Location may have multiple Mobilisation records over time.
- Each Mobilisation preserves its own purpose, scope, ownership, phase plan, readiness evidence, effective period, outcome and audit history.
- A later Mobilisation does not overwrite or replace earlier Mobilisation history.
- MNK-derived phase names remain workshop evidence and are not promoted into Canon.
