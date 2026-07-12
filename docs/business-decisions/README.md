# Business Decision Records

## Purpose

Business Decision Records (BDRs) preserve approved FIKA business meaning in the repository. They explain context, rationale, consequences and relationships without changing the human-approved decision wording.

BDRs are distinct from Architectural Decision Records in [`docs/decisions`](../decisions/README.md). A BDR governs business meaning; an ADR governs a reviewed architectural choice that implements upstream business authority.

## Current status

Stage 4 is active. The FIKA Business Knowledge Workbook contains 54 canonical decisions. The template is ready, but the 54 records have not yet been generated or reviewed.

## Authority and source

The [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) remains the approved decision source until each BDR is created and verified. A BDR must preserve its approved answer exactly.

## Naming

- Use a stable four-digit sequence followed by a concise slug: `0001-operational-location-definition.md`.
- Record the workbook Decision ID and Question ID inside the BDR.
- Do not reuse an ID after supersession.

## Statuses

- `Draft` — generated but not yet checked against the workbook and evidence
- `Proposed` — verified and awaiting decision-owner review
- `Accepted` — approved as the durable repository record
- `Superseded` — replaced by a named later BDR
- `Withdrawn` — deliberately removed before acceptance

## Generation rules

1. Read the canonical workbook row and copy the approved answer exactly.
2. Read the linked evidence and related canonical decisions.
3. Add context and rationale only where evidence supports them.
4. Use `TODO` rather than infer missing consequences or trade-offs.
5. Cross-link related records and identify supersession explicitly.
6. Validate that all 54 Decision IDs appear once and only once.
7. Do not update schemas, architecture or code during BDR generation.

## Template

Use [`000-template.md`](000-template.md).

## Index

TODO: Populate this index during the dedicated BDR-generation workflow.

