# FIKA Platform Working Instructions

## Purpose

This repository is the architectural source of truth for the FIKA operational platform.

## Scope

Include core FIKA operational systems only.

Exclude Bloom, HomeBuck, personal projects, and unrelated experiments.

## Working Rules

- Read `docs/documentation-governance.md` and the applicable canonical stage before changing repository knowledge.
- Inspect existing documentation before making changes.
- Preserve established terminology unless a change is explicitly documented.
- Do not invent site IDs, system IDs, schemas, or production behaviour.
- Do not include credentials or private secrets.
- Prefer configuration over hardcoded assumptions.
- Prefer canonical schemas over spreadsheet-specific logic.
- Prefer gradual migration over full rewrites.
- Record approved business meaning in `docs/business-decisions` through the governed BDR workflow.
- Record architectural decisions in `docs/decisions`; ADRs must not redefine upstream business decisions.
- Update related documentation when changing a schema or workflow.
- Mark assumptions clearly.
- Do not alter production repositories from this specs repository.

## Schema Rules

- Schemas must trace to accepted Business Decision Records and implement rather than invent business meaning.
- All schemas must be versioned.
- Use stable IDs.
- Use ISO 8601 timestamps.
- Define required and optional fields.
- Include validation rules.
- Include at least one valid fixture.
- Define ownership and source-of-truth.
- Avoid embedding provider-specific details into canonical objects unless required.

## Completion Requirements

Before finishing a task:

1. Review affected files.
2. Check links and terminology.
3. Ensure no secrets were introduced.
4. Ensure scope boundaries remain intact.
5. Summarise changes.
6. List unresolved decisions.
7. Confirm downstream documents do not conflict with higher documentation authority.
