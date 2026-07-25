# FIKA OS Specifications

This repository is the governed business, domain, schema and architecture specification for FIKA OS. It preserves why the platform exists, what FIKA's business concepts mean and how later delivery must implement that knowledge.

## Current stage

- **Stages 1–5:** Complete
- **Canonical decisions:** 54
- **Stage 5 baseline:** Packs 1–8, 51 schemas, 53 valid fixtures and 51 invalid fixtures
- **Fresh baseline validation:** Passed on 2026-07-25
- **Active stage:** [Stage 6 — Platform Architecture](docs/stages/stage-6-platform-architecture.md)

The repository contains all 54 durable Business Decision Records and the integrated Stage 5 schema baseline. A BDR may retain `Draft` metadata while its supporting explanation awaits review; its exact approved `Decision` section remains authoritative and is not superseded by that metadata.

## Start here

1. Read the repository instructions in [`AGENTS.md`](AGENTS.md).
2. Read [documentation governance](docs/documentation-governance.md) to understand authority and document status.
3. Review the [nine-stage roadmap](roadmap.md) and [stage files](docs/stages/stage-1-vision.md).
4. Use the [platform principles](docs/platform-principles.md) and [domain map](docs/platform-domain-map.md) for enduring context.
5. Use [domain discovery](docs/domain-discovery/) and [business journeys](docs/business-journeys/) as supporting evidence.
6. Use [Business Decision Records](docs/business-decisions/README.md) for canonical business meaning.
7. Use the integrated [`schemas/`](schemas/README.md) baseline as an input to Stage 6; existing pre-Pack booking material remains supporting draft evidence.
8. Use the [accepted target architecture](docs/target-architecture.md) and [ADR-001](docs/decisions/ADR-001-stage-6-platform-boundaries.md) for the initial Stage 6 responsibility boundaries.

## Repository navigation

| Area | Purpose | Authority |
|---|---|---|
| [`docs/stages/`](docs/stages/stage-1-vision.md) | Canonical staged lifecycle | Canonical process and status |
| [Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) | Approved decision register | Highest current business authority |
| [`docs/business-decisions/`](docs/business-decisions/README.md) | Durable business decisions | Stage 4 records; future accepted authority |
| [`docs/domain-discovery/`](docs/domain-discovery/) | Discovery hypotheses and evidence | Supporting evidence |
| [`docs/business-workshops/`](docs/business-workshops/) | Completed workshop material | Historical discovery evidence |
| [`docs/business-journeys/`](docs/business-journeys/) | Evidence-backed journeys | Supporting or canonical as stated |
| [`schemas/`](schemas/README.md) | Canonical domain contracts | Draft or adopted as each schema states |
| [`docs/decisions/`](docs/decisions/README.md) | Architectural Decision Records | Architecture authority only |
| [`inventory/`](inventory/applications.md) | Application, data and integration evidence | Supporting evidence |
| [`docs/engineering/`](docs/engineering/repository-standards.md) | Engineering standards | Canonical delivery guidance |

## Governing rule

Code, schemas, architecture and application specifications must follow approved business knowledge. They must not infer business meaning from current screens, spreadsheet columns, provider models or historical terminology.

## Safety

Do not store credentials, tokens, passwords, private certificates, service-account keys or sensitive production data here. Do not invent production facts. Use `TODO` where evidence remains genuinely incomplete.
