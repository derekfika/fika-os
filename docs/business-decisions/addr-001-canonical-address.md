# ADDR-001: Canonical Address Master Data

- **Decision ID:** ADDR-001
- **Workbook Decision ID:** Not allocated — explicitly authorised by the project owner on 2026-07-29
- **Status:** Accepted
- **Date:** 2026-07-29
- **Decision owner:** Derek / Operations
- **Related domains:** Address, Operational Location

## Context

Accepted LOC-003 keeps physical address master data outside the Operational Location aggregate. The Integration Hub already preserves provider and legacy Site address evidence, but no governed Address record existed to review that evidence or to satisfy an OPLOC `addressReference` safely.

## Decision

- Address is canonical master data separate from OPLOC.
- An OPLOC references its current approved Address through `addressReference`.
- `addressReference` stores a stable Address ID, never formatted address text.
- An Address may be created manually by an authorised user.
- Existing provider or legacy Site address data is evidence that may prefill a proposed Address.
- Prefilled evidence must be reviewed before becoming canonical.
- Provider evidence must remain preserved separately.
- Provider evidence must never be silently treated as approved canonical truth.
- A human-authored Address may exist without provider evidence.
- A valid, sufficiently complete Address supplied by an authorised user is automatically approved and published as part of the governed save.
- Automatic Address approval and publication must record the authenticated actor, provenance, revision and audit history.
- Address values are normalised and checked for duplicates before creation. An exact existing Address is reused; a likely duplicate requires an explicit human choice before a genuinely different Address is created.
- When an Address is created inside the OPLOC workflow, Address creation/publication and the OPLOC relationship save form one transaction. Failure must not leave the OPLOC referencing an unusable Address.
- Existing unpublished Addresses are not published blindly. Only schema-valid, complete and non-duplicate records may use the governed administrator bulk-publication action; incomplete and possible duplicate records remain for review.
- OPLOC must not embed duplicate structured-address fields that conflict with LOC-003.

## Business rationale

A stable Address record lets FIKA review and reuse structured location information without making provider text authoritative or expanding OPLOC beyond its accepted ownership boundary. Valid Address reference data has a low-friction automatic publication path, while normalization, duplicate checks, permissions and audit preserve governance.

## Positive consequences

- Users can work with readable, structured addresses without copying technical identifiers.
- OPLOC retains one stable reference and does not duplicate address master data.
- Provider evidence can reduce retyping while remaining visibly distinct from approved facts.
- Valid new Addresses become immediately reusable without a separate approval and publication journey.

## Trade-offs

- An OPLOC view must resolve its Address relationship to display the formatted address.
- Existing provider evidence still requires human review before it becomes canonical.
- Address changes and OPLOC relationship changes create separate governed history.
- Likely duplicates require a human decision and may interrupt an otherwise automatic save.

## Implementation implications

- Address requires its own versioned contract, canonical identity, editor, lifecycle and publication controls.
- OPLOC continues to store only `addressReference`; it must reject embedded structured-address fields.
- Source evidence remains in evidence records and is referenced rather than copied into canonical Address fields.
- Creating a valid Address automatically approves and publishes the Address, but does not publish the OPLOC.
- Inline Address creation and OPLOC relationship persistence must be transactional and retry-safe.
- Published Addresses are offered through one human-readable searchable selector; canonical IDs remain technical detail.

## Related decisions

- **Depends on:** [LOC-003 — Operational Location Ownership Boundary](loc-003-operational-location-boundary.md)
- **Related:** [LOC-006 — Operational Location Building and Address Boundary](loc-006-single-building-address.md)
- **Related:** [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md)
- **Related:** [ROLE-005 — Approval and Publication Separation](role-005-approval-publication-separation.md)

## Evidence

- Project-owner authority supplied on 2026-07-29 for the Governed Address Contract and OPLOC Address Workflow stage.
- [LOC-003 — Operational Location Ownership Boundary](loc-003-operational-location-boundary.md) — Accepted; explicitly excludes physical address master data from OPLOC.
- [LOC-006 — Operational Location Building and Address Boundary](loc-006-single-building-address.md) — Accepted; distinguishes an operational boundary from a postal-address boundary.
- [Canonical Human Decisions and Structured Record Editing](../../../apps/integration-hub/docs/canonical-human-decisions-and-structured-editing.md) — implementation evidence identifying the missing governed Address contract.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Amendment history

- **2026-07-29:** Derek amended the Address workflow so valid Address reference data is automatically approved and published. This replaces the original ADDR-001 requirements that Address save, approval and publication were always separate and that saving or inline linking could never publish an Address. The original requirements remain recorded here for history; the amended Decision above is current authority.

## Future considerations

- Effective-dated OPLOC-to-Address relationship history beyond canonical record revision and audit history requires a future business decision.
- Coordinates, geocoding and external address verification remain outside this decision.
