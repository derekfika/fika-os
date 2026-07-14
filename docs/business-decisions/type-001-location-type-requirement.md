# TYPE-001: Location Type Requirement and Ownership

- **Decision ID:** TYPE-001
- **Workbook Decision ID:** DEC-TYPE-001
- **Status:** Accepted
- **Date:** 2026-07-12T08:31:57.824Z
- **Decision owner:** Derek / Operations
- **Related domains:** Operational Location

## Context

Every OPLOC requires a Location Type so its fundamental operating model is explicit and consistently understood.

The former Decision established temporary personal ownership while discovery continued. This governed amendment replaces that temporary rule with durable, role-based Operations ownership while preserving the previous wording and approval history.

## Decision

Every Operational Location must have a Location Type. The Location Type catalogue is owned by the Operations function. Operations Managers and above may administer the catalogue, while material additions, renames and retirements require senior operational approval. Authority is role-based rather than assigned to named individuals. Catalogue administration does not grant authority to redefine canonical business language, and changes with schema, reporting or migration impact require platform-governance assessment.

## Decision history

- **Previous approved Decision:** Yes. I'll own it for now.
- **Previous Decision date:** 2026-07-12
- **Amended Decision approved:** 2026-07-13
- **Amendment reason:** Replaced temporary personal ownership with mandatory Location Type use and durable role-based governance while preserving the previous decision history.

## Business rationale

Location Type affects how FIKA describes an OPLOC's fundamental operating model. Its catalogue therefore requires stable organisational ownership and controlled change rather than authority assigned permanently to named individuals.

Operations Managers and above may administer the catalogue within approved rules. Material additions, renames and retirements require senior operational approval, while changes with schema, reporting or migration impact also require platform-governance assessment.

## Positive consequences

- Every OPLOC has an accountable Location Type.

- Catalogue administration continues when individual role holders change.

- Material catalogue changes receive appropriate operational approval.

- Business-language authority remains separate from day-to-day catalogue administration.

- Cross-domain, reporting and migration impacts are assessed before disruptive changes are applied.

## Trade-offs

- Catalogue changes may require both operational approval and platform-governance assessment.

- Role-based authority requires clear assignments and audit history.

- Operational administration cannot be used as a shortcut to redefine canonical language.

## Implementation implications

- Future workflows must use organisational roles and approval authority rather than fixed lists of named individuals.

- Location Type administration must distinguish routine catalogue maintenance from material additions, renames and retirements.

- Any later schema, reporting or migration work must trace its Location Type governance to this amended Decision.

## Related decisions

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Directly informs:** [TYPE-002 — Primary Location Type](type-002-primary-location-type.md)
- **Directly informs:** [TYPE-003 — Location Type History](type-003-location-type-history.md)

Source traceability links retained for reversible Markdown reconstruction:

- [TYPE-002](type-002-primary-location-type.md)
- [TYPE-003](type-003-location-type-history.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-TYPE-001, sourced from `Questions!18`.
- [docs/business-workshops/location-type-catalogue.md](../business-workshops/location-type-catalogue.md) — **Historical**; `Type model questions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** Previous TYPE-001 Decision approved 2026-07-12 — Yes. I'll own it for now.
- **Superseded by:** None

## Future considerations

- Stage 5 may express the mandatory Location Type relationship and catalogue governance only after authorised repository write-back and BDR acceptance.

- Future governance may refine assignment, delegation and audit requirements without reverting to named-person authority.

- No schema is authorised by this amendment task.
