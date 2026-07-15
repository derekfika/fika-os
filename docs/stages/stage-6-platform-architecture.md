# Stage 6 — Platform Architecture

## Purpose

Define how approved domains, schemas and policies compose into FIKA OS while keeping technology and storage replaceable.

## Business outcome

FIKA has a coherent platform design in which applications consume stable business meaning rather than recreating it.

## Inputs

- Approved BDRs
- Completed and committed canonical schemas
- Platform principles and domain map
- Current-system evidence and migration constraints

## Core activities

- Define domain and service boundaries.
- Define identity, configuration, permission and validation responsibilities.
- Specify repository interfaces and integration contracts.
- Map events, workflows, notifications and audit flows.
- Define application composition, adapters and transitional support.

## Required artefacts

- Target architecture
- FIKA Core specification
- Repository and workflow boundaries
- Integration and migration architecture
- Architecture decisions where needed

## Exit criteria

- Architecture implements approved decisions and schemas.
- Canonical records, projections and adapters are clearly distinguished.
- Storage and provider choices do not redefine business meaning.
- Security, reliability and migration consequences are reviewable.

## Current status

**Planned.** Preliminary target-architecture and FIKA Core documents are conceptual inputs, not implementation authority.

## Dependencies on earlier stages

- Stages 1–5

## Outputs consumed by later stages

Stages 7 and 8 use the architecture to constrain implementation, testing, rollout and recovery.

## Out of scope

- Production code
- Deployment
- Selecting technology without evidence
- Reopening approved business meaning

## Authoritative documents

- [Target architecture](../target-architecture.md)
- [FIKA Core overview](../fika-core/overview.md)
- [Platform domain map](../platform-domain-map.md)
- [Architecture review checklist](../engineering/architecture-review-checklist.md)
