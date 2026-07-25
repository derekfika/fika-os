# Stage 4 — Business Decision Records

## Purpose

Convert each approved canonical decision into a durable Business Decision Record (BDR) that explains its context, rationale, consequences and relationships.

## Business outcome

FIKA can understand not only what was decided, but why it was decided and what future work must respect.

## Inputs

- The 54 canonical workbook decisions
- Stage 2 evidence and journeys
- Stage 3 provenance and contradiction history

## Core activities

- Create one stable BDR for each canonical decision.
- Preserve the approved answer exactly as the decision.
- Add context, rationale, consequences and evidence without inventing policy.
- Cross-link related and superseding decisions.
- Review records with the decision owner.

## Required artefacts

- BDR index
- Numbered Business Decision Records
- Traceability from workbook decision to evidence and downstream work

## Exit criteria

- All 54 decisions have reviewed BDRs.
- Each BDR identifies its owner, evidence and related decisions.
- No BDR changes the approved business meaning.
- Duplicate, superseded and conflicting records are explicitly linked.

## Current status

**Complete.** Stage 4 produced all 54 governed BDRs. Their exact approved Decision sections supplied the business authority consumed by the completed Stage 5 Packs 1–8.

Pack 1—CLIENT-001, LOC-001 through LOC-006, and TYPE-001 through TYPE-003—is **Frozen** for current downstream use. Frozen means the pack is the current canonical business authority and is stable enough for downstream schema dependency. It is not immutable forever: future change must use a governed amendment or superseding BDR. The freeze does not rewrite accepted business meaning.

BDR status metadata describes the review state of each complete record. Draft supporting explanation does not override or weaken the exact approved Decision wording used by downstream schema Packs.

## Dependencies on earlier stages

- Stage 1 — Vision
- Stage 2 — Domain Discovery
- Stage 3 — Business Discovery

## Outputs consumed by later stages

Stage 5 derives schemas from BDRs. Stage 6 uses BDRs to explain architecture boundaries and governance.

## Out of scope

- Inventing or reopening business decisions
- Defining database tables or APIs
- Adopting schemas
- Application implementation

## Authoritative documents

- [Business Decision Records](../business-decisions/README.md)
- [BDR template](../business-decisions/000-template.md)
- [Business-discovery methodology](../platform-methodology/business-discovery-process.md)
