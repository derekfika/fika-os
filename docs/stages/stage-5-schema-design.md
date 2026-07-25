# Stage 5 — Schema Design

## Purpose

Translate approved business decisions into versioned canonical domain schemas without inventing business meaning.

## Business outcome

Applications and workflows can exchange consistent business records whose identity, ownership, validation and lifecycle are explicit.

## Inputs

- Approved BDRs
- Canonical domain definitions and journeys
- Existing draft models, downstream evidence and compatibility reviews

## Core activities

- Define aggregate and value-object boundaries.
- Specify stable identity, versions, timestamps, statuses and ownership.
- Separate required, optional, provider and projection data.
- Create non-production fixtures and validation tests.
- Review compatibility, privacy, amendment and migration consequences.

## Required artefacts

- Versioned schema catalogue
- Domain-model guidance
- Valid and invalid fixtures
- Validation evidence
- Schema completion and repository-integration record

## Exit criteria

- Each schema traces to approved BDRs.
- Required and optional fields are explicit.
- Fixtures validate and contain no sensitive production data.
- Ownership and source of truth are stated.
- The Pack completes validation and deterministic repository integration; incomplete drafts are never presented as completed.

## Current status

**Complete — closed on 2026-07-25.** Packs 1–8 contain 51 integrated schemas, 53 valid fixtures, 51 invalid fixtures, traceability and reproducible validation. Fresh Draft 2020-12, reference, fixture, BDR and link validation passed at closure.

The earlier standalone `FikaBooking` material remains supporting draft evidence; the governed Pack 4 Booking contracts are the Stage 5 baseline. Draft BDR metadata may remain where supporting explanation has not been fully accepted, but exact approved Decision sections remain authoritative.

See the [Stage 5 closure record](stage-5-closure-2026-07-25.md).

## Dependencies on earlier stages

- Stages 1–4, especially approved BDRs

## Outputs consumed by later stages

Stages 6–8 use adopted schemas as stable contracts for architecture, implementation and validation.

## Out of scope

- Selecting a database or storage product
- Defining application screens
- Implementing repositories, services or adapters
- Deploying schema changes

## Authoritative documents

- [Schemas directory](../../schemas/README.md)
- [FikaBooking draft domain model](../domain-models/fika-booking-v1.md)
- [FikaBooking formal review](../schema-reviews/fika-booking-v1-review.md)
