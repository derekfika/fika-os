# FIKA Core Overview

## Status

Stage 6 supporting specification constrained by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md) and [ADR-005](../decisions/ADR-005-domain-event-and-integration-contract.md) through [ADR-010](../decisions/ADR-010-legacy-coexistence-and-retirement.md). Where an older FIKA Core catalogue conflicts with an accepted ADR or governed business meaning, the accepted ADR and governing BDR take precedence.

## Purpose

FIKA Core is the smallest stable set of domain-neutral contracts needed for FIKA OS components to work together without sharing storage models, provider payloads or application assumptions.

It is a contract layer, not a business super-domain and not a general shared-code folder.

## Position

```text
Applications
    ↓
Application orchestration
    ↓
Logical domain services
    ↓
FIKA Core contracts
    ↓
Repository, projection and provider ports
    ↓
Adapters and implementations
```

Logical dependency does not dictate deployment topology.

## Core responsibilities

Core may standardise:

- identifier and cross-record reference conventions;
- schema-version and record-version conventions;
- effective-time, provenance and audit conventions;
- trusted actor, Assignment and Authority Grant references governed by ADR-008;
- correlation, causation, idempotency and concurrency context;
- common validation-issue and operation-result shapes;
- the ADR-005 domain-event envelope and compatibility conventions;
- repository, comparison and operation-outcome conventions governed by ADR-006;
- narrow projection source-link, checkpoint, freshness and outcome conventions governed by ADR-007.

Core supplies no domain decision merely because multiple domains use the same structural convention.

## Explicit exclusions

Core does not own:

- Client, Operational Location, Authority, Capability, Configuration, Service, Booking, Event, Production, Mobilisation, Brand or Waste records;
- domain invariants, lifecycle values or approval policy;
- roles, assignments, authority grants or access entitlement;
- configuration values or inheritance decisions;
- end-to-end workflows;
- notification recipient policy;
- brand standards or variations;
- documents, quotes, calendars or provider records;
- applications, dashboards or read projections;
- provider SDKs and storage implementations;
- utilities that lack stable domain-neutral meaning.

## Admission test

A concern belongs in FIKA Core only when every answer is yes:

1. Is it required by more than one governed domain?
2. Is its meaning independent of any one domain, application, provider and storage choice?
3. Would separate definitions create a real interoperability or governance risk?
4. Can it be specified without importing domain policy?
5. Is its meaning stable enough to version as a platform contract?

If not, it remains in the owning domain, orchestration layer, port or adapter.

## Relationship to domain services

Domain services consume Core contracts but own their own commands, queries, records, invariants and events. Core never calls a domain service to make a business decision and never becomes the shared owner of an aggregate.

## Relationship to AUTHMOD

Core may carry a minimal integrity-protected actor context and request an AUTHMOD evaluation through a port. AUTHMOD owns the governed action vocabulary and grant semantics. Core does not infer authority from authentication, account mapping, Assignment, ownership, capability state, Configuration, application access or technical administration.

## Relationship to repositories and adapters

Core defines common port behaviour only where it is truly cross-domain. Domain repository contracts remain named and owned by their domains. Consistency scopes follow governed invariants rather than schemas, and implementations and providers remain behind adapters.

## Specification map

- [Service catalogue](service-catalog.md): governed logical domain-service boundaries.
- [Repository catalogue](repository-catalog.md): domain repository, projection and adapter-port responsibilities.
- [Workflow catalogue](workflow-catalog.md): domain command versus cross-domain orchestration boundaries.
- [Configuration model](configuration-model.md): configuration ownership and resolution boundary.
- [Notification model](notification-model.md): notification intent versus delivery.
- [Validation model](validation-model.md): structural, business, authority, workflow and provider validation.
- [Brand system](brand-system.md): governed Brand boundary and rendering concerns.
- [Permissions model](permissions-model.md): AUTHMOD enforcement boundary.

## Open questions

- Physical delivery implementation and domain-specific retention policy.
- Domain-specific merge, compensation and conflict policies where business authority is unresolved.
- Person, Worker, actor and account ownership/lifecycle policy.
- Whether a common audit store is needed or only common audit conventions.

These require the follow-up ADRs registered in ADR-001.
