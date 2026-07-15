# MOB-004: Mobilisation Task Classification

- **Decision ID:** MOB-004
- **Workbook Decision ID:** DEC-MOB-004
- **Status:** Draft
- **Date:** 2026-07-12T09:14:56.775Z
- **Decision owner:** Derek / Mobilisation owner / Domain owners
- **Related domains:** Mobilisation, Operational Capability

## Context

Business discovery asked: **Which tasks are mandatory, capability-conditional or client/site-specific?**

Before approval, the recorded evidence stated: “Reusable patterns exist; optionality is not classified.” The question was recorded as a refinement decision with medium repository confidence before approval.

## Decision

Mobilisation tasks should be classified as Mandatory, Capability-Conditional or Client/Site-Specific. Mandatory tasks are required for every Operational Location and include governance, ownership assignment, health and safety, supplier setup, operational readiness and core platform configuration. Capability-Conditional tasks are generated automatically according to the capabilities enabled for the Operational Location, such as Hospitality, Coffee, Production, Events, Logistics or Feedback. Client- and Site-Specific tasks capture commercial, contractual or operational requirements unique to a particular mobilisation without becoming part of the canonical mobilisation journey. This approach preserves a consistent mobilisation process while allowing each Operational Location to receive only the work relevant to its operating model.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md), specifically the section `Recurring patterns worth preserving`. Without a canonical decision, later documents or applications could interpret this subject differently.

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
- **Depends on:** [CAP-001 — Operational Capability Definition](cap-001-operational-capability-definition.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-MOB-004, sourced from `Questions!46`.
- [docs/business-journeys/new-site-mobilisation-journey.md](../business-journeys/new-site-mobilisation-journey.md) — **Supporting**; `Recurring patterns worth preserving`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 7 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- Capability launches and material operating-model changes may legitimately create a Mobilisation without a Client-contractual basis.
- Routine operational changes do not create new Mobilisation records unless approved business policy classifies the change as material enough for Mobilisation governance.
- The exact material-remobilisation threshold remains deferred.
