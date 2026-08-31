# FIKA OS Specifications

This repository is the governed business, domain, schema and architecture specification for FIKA OS. It preserves why the platform exists, what FIKA's business concepts mean and how later delivery must implement that knowledge.

## Current stage

- **Stages 1–5:** Complete
- **Canonical decisions:** 54
- **Stage 5 baseline:** Packs 1–8, 51 schemas, 53 valid fixtures and 51 invalid fixtures
- **Fresh baseline validation:** Passed on 2026-07-25
- **Stage 6:** Complete — closed 2026-07-27 ([closure review](docs/stages/stage-6-closure-2026-07-27.md))
- **Stage 7:** Active — [Increment 1](docs/stages/stage-7-increment-1-shadow-cpu-production-charter.md) remains governed, while current UAT implementation work and the [current implementation alignment](docs/stages/stage-7-current-implementation-alignment-2026-08-31.md) are recorded separately. The physical projection/read-package strategy is proposed in [ADR-012](docs/decisions/ADR-012-materialised-read-packages-and-local-projection-caching.md).

The repository contains all 54 durable Business Decision Records and the integrated Stage 5 schema baseline. Stage 6 has accepted its platform-boundary, domain-event, repository-consistency, projection/dashboard, identity/AUTHMOD, Booking-to-Production orchestration, legacy-coexistence and notification contracts through ADR-001 and ADR-005–011. ADR-012 is a Proposed Stage 7 implementation architecture selecting the physical read-package boundary without changing those accepted contracts. A BDR may retain `Draft` metadata while its supporting explanation awaits review; its exact approved `Decision` section remains authoritative and is not superseded by that metadata.

## Start here

1. Read the repository instructions in [`AGENTS.md`](AGENTS.md).
2. Read [documentation governance](docs/documentation-governance.md) to understand authority and document status.
3. Review the [nine-stage roadmap](roadmap.md) and [stage files](docs/stages/stage-1-vision.md).
4. Use the [platform principles](docs/platform-principles.md) and [domain map](docs/platform-domain-map.md) for enduring context.
5. Use [domain discovery](docs/domain-discovery/) and [business journeys](docs/business-journeys/) as supporting evidence.
6. Use [Business Decision Records](docs/business-decisions/README.md) for canonical business meaning.
7. Use the integrated [`schemas/`](schemas/README.md) baseline and accepted Stage 6 architecture as inputs to future governed implementation; existing pre-Pack booking material remains supporting draft evidence.
8. Use the [accepted target architecture](docs/target-architecture.md) and [ADR-001](docs/decisions/ADR-001-stage-6-platform-boundaries.md) for the initial Stage 6 responsibility boundaries.
9. Use [ADR-005](docs/decisions/ADR-005-domain-event-and-integration-contract.md) for the domain-event and cross-boundary integration contract.
10. Use [ADR-009](docs/decisions/ADR-009-booking-to-production-orchestration.md) for the Booking-to-Production orchestration contract.
11. Use [ADR-010](docs/decisions/ADR-010-legacy-coexistence-and-retirement.md) for legacy coexistence, readiness, cutover, fallback and retirement boundaries.
12. Use [ADR-011](docs/decisions/ADR-011-notification-generation-and-delivery.md) for notification intent, recipient/content resolution, delivery attempts and qualified outcome boundaries.
13. Use [ADR-012](docs/decisions/ADR-012-materialised-read-packages-and-local-projection-caching.md) for the proposed physical materialised read-package and local-cache strategy, and the [Stage 7 alignment register](docs/stages/stage-7-current-implementation-alignment-2026-08-31.md) for current-state evidence.

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
