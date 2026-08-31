# Architectural Decision Records

Architectural Decision Records (ADRs) explain reviewed technical and platform-architecture choices. They are downstream of approved business meaning and are distinct from [Business Decision Records](../business-decisions/README.md).

## Authority

An ADR must implement approved BDRs and adopted schemas. It must not invent or silently change business meaning.

## Current records

- [ADR-001 — Stage 6 Platform Boundaries](ADR-001-stage-6-platform-boundaries.md) — accepted initial Stage 6 responsibility model for domains, narrow FIKA Core, orchestration, repositories, projections and adapters.
- [ADR-003 — Canonical Booking and Ingestion Adapters](ADR-003-canonical-booking-and-ingestion-adapters.md) — superseded, never-adopted pre-Pack proposal retained as historical rationale; later governed Booking contracts and ADR-006/007/009/010 control implementation.
- [ADR-004 — Booking-to-Production Boundary](ADR-004-booking-to-production-boundary.md) — accepted supporting direction retained for history and reconciled by ADR-009, which controls the current orchestration contract.
- [ADR-005 — Domain Event and Integration Contract](ADR-005-domain-event-and-integration-contract.md) — accepted technology-neutral contract for completed facts, integration events, delivery, idempotency, ordering and replay.
- [ADR-006 — Repository and Consistency Contract](ADR-006-repository-and-consistency-contract.md) — accepted technology-neutral contract for domain-owned repositories, canonical persistence, concurrency, cross-domain consistency, partial failure and recovery.
- [ADR-007 — Projection and Dashboard Boundary](ADR-007-projection-and-dashboard-boundary.md) — accepted technology-neutral contract for projection ownership, freshness, rebuilding, reporting and authorised dashboard interaction.
- [ADR-008 — Identity and AUTHMOD Enforcement Boundary](ADR-008-identity-and-authmod-enforcement-boundary.md) — accepted provider-neutral contract for authentication evidence, actor mapping, AUTHMOD evaluation and authoritative enforcement.
- [ADR-009 — Booking-to-Production Orchestration](ADR-009-booking-to-production-orchestration.md) — accepted technology-neutral contract for eligibility, creation, amendments, cancellation, partial outcomes, recovery and reconciliation across the Booking and Production boundary.
- [ADR-010 — Legacy Coexistence and Retirement](ADR-010-legacy-coexistence-and-retirement.md) — accepted technology-neutral contract for bounded coexistence, authority direction, readiness, cutover, fallback, retirement and retained history.
- [ADR-011 — Notification Generation and Delivery](ADR-011-notification-generation-and-delivery.md) — accepted technology-neutral contract for notification intent, recipient/content resolution, delivery attempts, provider observations, acknowledgement and reconciliation.
- [ADR-012 — Materialised Read Packages and Local Projection Caching](ADR-012-materialised-read-packages-and-local-projection-caching.md) — proposed Stage 7 implementation architecture for immutable package publication, manifests, local caches, lineage, freshness, security and gradual adoption of ADR-007 projections.

ADR-001 contains the controlled register of required follow-up ADRs. ADR-005 through ADR-011 are complete. ADR-012 is proposed and requires human governance approval before it is treated as accepted implementation authority.

## Status convention

- Proposed
- Accepted
- Superseded
- Withdrawn

Every ADR should state context, decision, consequences, status and related upstream BDRs/schemas.
