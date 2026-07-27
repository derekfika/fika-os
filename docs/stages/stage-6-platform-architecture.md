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

The second bounded task, the technology-neutral domain-event and integration contract, is complete and accepted through ADR-005.

The third bounded task, the technology-neutral repository and consistency contract, is complete and accepted through ADR-006.

The fourth bounded task, the technology-neutral projection and dashboard boundary, is complete and accepted through ADR-007.

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

## Second bounded deliverable

Completed on 2026-07-25:

- accepted [ADR-005](../decisions/ADR-005-domain-event-and-integration-contract.md);
- distinguished domain events, integration events, commands, queries, notifications, provider webhooks, audit entries and Event-domain records;
- established a logical event envelope, ownership and compatibility rules;
- established duplicate-safe delivery, ordering limitations, correlation, causation, retry, quarantine and replay principles;
- protected provider, legacy, security, privacy, audit and observability boundaries; and
- remained neutral on messaging infrastructure, serialization, storage, event sourcing and deployment topology.

No event catalogue, business trigger, Stage 5 schema or implementation was created.

## Third bounded deliverable

Completed on 2026-07-27:

- accepted [ADR-006](../decisions/ADR-006-repository-and-consistency-contract.md);
- established domain-owned repository, write-model, domain-query, projection, provider, legacy and workflow-state boundaries;
- established invariant-led consistency scopes, optimistic concurrency expectations and explicit conflict outcomes;
- established idempotent command, partial-failure, reconciliation and recoverable event-publication rules; and
- remained neutral on storage, transaction, messaging, framework, hosting and deployment choices.

No aggregate catalogue, physical persistence design, Stage 5 schema or implementation was created.

## Fourth bounded deliverable

Completed on 2026-07-27:

- accepted [ADR-007](../decisions/ADR-007-projection-and-dashboard-boundary.md);
- established projection ownership, source linkage, freshness, completeness, checkpoint, rebuild and reconciliation rules;
- established authoritative-query, dashboard-read, dashboard-command, reporting and export boundaries;
- applied the general contract to the Hospitality dashboard without transferring Booking or Production ownership; and
- remained neutral on projection storage, processing, dashboard, reporting, hosting and deployment technology.

No dashboard implementation, physical read model, numerical service level, Stage 5 schema or ADR-009 workflow was created.

## Next bounded work

ADR-001 registers the required follow-up decisions. ADR-005, ADR-006 and ADR-007 have completed items 1–3 below. The next bounded task is **ADR-008: Identity and AUTHMOD Enforcement Boundary**.

1. domain-event and integration guarantees — complete through ADR-005;
2. repository and cross-domain consistency — complete through ADR-006;
3. projection and dashboard boundaries — complete through ADR-007;
4. identity-to-AUTHMOD enforcement — next through ADR-008;
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
- [ADR-005 — Domain Event and Integration Contract](../decisions/ADR-005-domain-event-and-integration-contract.md).
- [ADR-006 — Repository and Consistency Contract](../decisions/ADR-006-repository-and-consistency-contract.md).
- [ADR-007 — Projection and Dashboard Boundary](../decisions/ADR-007-projection-and-dashboard-boundary.md).
- [FIKA Core overview](../fika-core/overview.md).
- [Platform domain map](../platform-domain-map.md).
- [Architecture review checklist](../engineering/architecture-review-checklist.md).
