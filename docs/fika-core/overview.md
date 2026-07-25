# FIKA Core Overview

## Status

First conceptual draft. This specification is not an implementation, deployment plan, adopted schema catalogue, or authority to refactor existing applications.

## Purpose

FIKA Core is the shared conceptual platform beneath future FIKA applications. It defines common business contracts, service responsibilities, workflow boundaries, configuration, validation, permissions, notifications, branding, and repository interfaces so applications do not recreate the same meaning independently.

FIKA Core exists to make each new site, client experience, operational surface, and business capability easier to establish without multiplying code, configuration, manual reconciliation, or competing sources of truth.

## Position in the target architecture

```text
FIKA OS experiences
  -> Domain modules
  -> FIKA Core
  -> Repository interfaces
  -> Storage and external integrations
```

FIKA Core serves public, client-facing, administrative, and internal operational experiences without requiring them to share one interface, brand, release, or deployment.

## Core responsibilities

FIKA Core should provide:

- canonical, versioned domain contracts;
- shared business-service boundaries;
- reusable workflow definitions;
- repository interfaces expressed in domain terms;
- configuration ownership, inheritance and validation;
- permission decisions at authoritative boundaries;
- common validation and result semantics;
- notification intent separated from channel delivery;
- brand identity and override rules;
- identity, idempotency, concurrency and audit expectations;
- adapter contracts for external systems, projections and legacy inputs;
- migration and compatibility guidance.

## What FIKA Core is not

FIKA Core is not:

- one application, user interface or deployment;
- a physical database or file layout;
- a replacement for domain ownership;
- a container for every shared-looking helper;
- an operational dashboard or reporting view;
- a provider-specific integration library;
- a place for site-specific rules that are not genuinely shared;
- permission to consolidate working systems prematurely;
- an owner of raw legacy documents, parser layouts or UI state.

## Conceptual boundaries

### Domain services

Services own business capabilities and invariants. They coordinate repositories, validation, permissions and effects through stable conceptual operations. A service must have one clear business responsibility and an identified owner before implementation.

### Repositories

Repositories provide domain-oriented access to canonical records, configuration, files, audit history and projections. They conceal physical storage and provider details. A repository does not decide business policy.

### Workflows

Workflows coordinate a business outcome across services and effects. They define inputs, outputs, ownership, idempotency, versioning, partial failure and recovery. A workflow does not make projections authoritative.

### Adapters

Adapters translate external, legacy or provider-specific representations into or out of Core contracts. They own mapping, provider references, retries and diagnostics, but do not invent missing business facts.

### Applications and projections

Applications request Core capabilities and render authorised views. Dashboard, Calendar, document and reporting representations are projections unless a specific domain decision establishes otherwise.

## Design principles

1. Business meaning is independent of storage, interface and provider.
2. Every canonical record and configuration value has explicit ownership.
3. Public/client experiences remain distinct from internal operations while sharing authoritative facts.
4. Commands are duplicate-safe and version-aware where effects or concurrent mutations are possible.
5. Human judgement remains explicit when policy is unresolved.
6. Configuration represents genuine variation; different business behaviour remains visible.
7. Migration is gradual, measurable, reversible and supported by adapters.
8. Security, privacy, accessibility, audit and recovery are design responsibilities.
9. Performance change follows measurement.
10. Core grows only when repeated business meaning and ownership are proven.

## Initial domain relationship

Hospitality evidence establishes this direction:

```text
Booking channel
  -> Booking Service
  -> authoritative FikaBooking
  -> Hospitality operational projections
  -> Production Creation workflow
  -> governed Production Order
  -> future Logistics workflows
```

Calendar-led CPU discovery, inbox/form parsing and current Sheets remain transitional adapters or projections. They do not define future Core identity or status.

Stage 5 now provides governed Event and Production contracts alongside the other Packs 1–8 domains. Stage 6 must reconcile these conceptual Core boundaries with that baseline before selecting an implementation shape.

## Core growth test

A capability should enter FIKA Core only when:

- at least one confirmed domain needs it and reuse is credible;
- its business meaning and owner are clear;
- its boundary can be stated without current storage or provider terminology;
- inputs, outputs, permissions, failure and audit expectations are understood;
- variation can be represented without hiding incompatible rules;
- adoption can proceed without breaking current operations;
- tests and compatibility expectations can protect consumers.

If these conditions are absent, keep the capability in its domain or adapter until evidence improves.

## Specification map

- `service-catalog.md`: candidate business and platform services.
- `repository-catalog.md`: conceptual persistence/access boundaries.
- `workflow-catalog.md`: cross-service business workflows.
- `configuration-model.md`: configuration scopes, ownership and inheritance.
- `notification-model.md`: notification intent and delivery separation.
- `validation-model.md`: validation layers and result semantics.
- `brand-system.md`: identity, assets and override hierarchy.
- `permissions-model.md`: conceptual actors, roles, scopes and decisions.

## Open questions

- TODO: Confirm service and domain owners.
- TODO: Decide the first adopted Core contracts and compatibility policy.
- TODO: Confirm identity, user and organisation boundaries.
- TODO: Define audit, privacy, retention, recovery and operational service expectations.
- TODO: Confirm the configuration decision forum and override governance.
- TODO: Define when a capability graduates from domain-specific to Core.
