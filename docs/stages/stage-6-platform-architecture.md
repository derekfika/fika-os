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

**Active from 2026-07-25.** Stage 6 consumes the governed and freshly validated Stage 5 Packs 1–8. Preliminary target-architecture and FIKA Core documents remain conceptual inputs until reconciled through this stage; they are not implementation authority merely because they already exist.

## Entry brief

Stage 6 must establish:

- authoritative domain and service boundaries;
- the responsibilities and limits of FIKA Core;
- repository interfaces without prematurely selecting storage;
- application workflows and orchestration boundaries;
- domain events, notifications and audit flows;
- canonical records versus dashboards, operational projections and reporting views;
- provider and legacy adapters that preserve provenance without redefining business meaning;
- permission, Operational Capability and configuration enforcement;
- gradual migration and coexistence with stable legacy workflows;
- the Architecture Decision Records required before implementation; and
- architectural questions that must return to the BDR process because they require business policy.

Stage 6 consumes the Stage 5 schemas; it does not casually rewrite their business meaning. Architecture may identify a contradiction or missing policy, but any resulting change to business meaning must return through governed discovery and the BDR process before a schema is revised.

The current baseline includes governed contracts for foundational Client and Operational Location concepts, authority and capability, Service, Booking, Event, Production, Mobilisation, Brand Variation and Waste. Stage 6 must not treat the earlier standalone `FikaBooking` draft as the only schema, describe Events or Production as awaiting initial schema discovery, or assume stable legacy applications must be replaced immediately.

## Initial architecture questions

- Which candidate FIKA Core responsibilities belong in shared Core versus an owning domain?
- Which canonical aggregates require transactional coordination, and where are eventual consistency and rebuildable projections sufficient?
- Which domain events and effect records are required for reliable notification, audit and adapter workflows?
- How should permission, capability and effective configuration decisions be enforced consistently at application and domain boundaries?
- Which legacy workflows should coexist first through adapters, and what evidence will govern later migration or retirement?
- Which unresolved ownership, authority, lifecycle or policy questions must return to a BDR rather than be answered architecturally?

## First bounded deliverable

Reconcile the preliminary target architecture and FIKA Core catalogues against Packs 1–8, then produce one architecture-boundary decision covering canonical services, repositories, projections and adapters. Do not select storage or begin implementation in that deliverable.

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
