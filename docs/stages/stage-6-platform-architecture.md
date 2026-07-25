# Stage 6 — Platform Architecture

## Purpose

Define how approved domains, schemas and policies compose into FIKA OS while keeping technology and storage replaceable.

## Business outcome

FIKA has a coherent platform design in which applications consume stable business meaning rather than recreating it.

## Inputs

- Approved BDRs.
- Completed and integrated Packs 1–8 and their canonical schema contracts.
- Platform principles and domain map.
- Current-system evidence and migration constraints.

## Core activities

- Define logical domain-service boundaries.
- Define the narrow responsibilities and exclusions of FIKA Core.
- Specify repository, projection and provider ports without choosing storage.
- Define application orchestration, domain-event, notification and audit boundaries.
- Define authority, Operational Capability, configuration and validation enforcement.
- Classify current systems and govern gradual coexistence and migration.
- Record decisions and return missing business policy to the BDR process.

## Required artefacts

- Target architecture.
- FIKA Core supporting catalogues.
- Repository, projection, workflow and adapter boundaries.
- Integration and migration architecture decisions.
- Architecture Decision Records required before implementation.

## Exit criteria

- Architecture implements approved decisions and schemas without rewriting them.
- Canonical records, operational systems, projections, providers and legacy adapters are distinguished.
- Domain service and orchestration responsibilities are explicit.
- Storage and provider choices cannot redefine business meaning.
- Security, reliability, observability and migration consequences are reviewable.
- Business-policy gaps are returned to governed discovery.

## Current status

**Active from 2026-07-25.** Stage 6 consumes the governed and freshly validated Stage 5 Packs 1–8.

The first bounded architecture reconciliation is complete and accepted through ADR-001. Stage 6 remains active; no implementation is authorised by that completion.

## Entry brief

The completed Stage 5 baseline includes governed contracts for foundational Client and Operational Location concepts, authority and capability, Service, Booking, Event, Production, Mobilisation, Brand Variation and Waste. Stage 6 consumes those contracts and does not casually rewrite their business meaning.

Architecture may identify a contradiction or missing policy, but any change to business meaning must return through governed discovery and the BDR process before a schema is revised.

## First bounded deliverable

Completed on 2026-07-25:

- reconciled the target architecture and FIKA Core catalogues against Packs 1–8;
- established governed logical domain-service boundaries;
- narrowed FIKA Core to domain-neutral contracts;
- distinguished repositories, projections, providers and legacy adapters;
- established enforcement, orchestration, event, notification, audit and coexistence principles; and
- accepted [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md).

No storage, provider, deployment topology or production implementation was selected.

## Next bounded work

ADR-001 registers the required follow-up decisions. Before implementation, Stage 6 should address:

1. domain-event and integration guarantees;
2. repository and cross-domain consistency;
3. projection and dashboard boundaries;
4. identity-to-AUTHMOD enforcement;
5. Booking-to-Production orchestration; and
6. legacy coexistence, cutover and retirement.

Notification detail should be decided only when a shared capability is authorised. Business-policy gaps identified during this work return to discovery or a BDR.

## Dependencies on earlier stages

- Stages 1–5.

## Outputs consumed by later stages

Stages 7 and 8 use the architecture to constrain implementation, testing, rollout and recovery.

## Out of scope

- Production code.
- Schema or BDR changes.
- Deployment.
- Storage, hosting or provider selection without its own evidence and decision.
- Reopening approved business meaning.

## Authoritative documents

- [Target architecture](../target-architecture.md).
- [ADR-001 — Stage 6 Platform Boundaries](../decisions/ADR-001-stage-6-platform-boundaries.md).
- [FIKA Core overview](../fika-core/overview.md).
- [Platform domain map](../platform-domain-map.md).
- [Architecture review checklist](../engineering/architecture-review-checklist.md).
