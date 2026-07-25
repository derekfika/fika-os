# Architectural Decision Records

Architectural Decision Records (ADRs) explain reviewed technical and platform-architecture choices. They are downstream of approved business meaning and are distinct from [Business Decision Records](../business-decisions/README.md).

## Authority

An ADR must implement approved BDRs and adopted schemas. It must not invent or silently change business meaning.

## Current records

- [ADR-001 — Stage 6 Platform Boundaries](ADR-001-stage-6-platform-boundaries.md) — accepted initial Stage 6 responsibility model for domains, narrow FIKA Core, orchestration, repositories, projections and adapters.
- [ADR-003 — Canonical Booking and Ingestion Adapters](ADR-003-canonical-booking-and-ingestion-adapters.md) — proposed draft requiring reconciliation with completed BDRs and schema work.
- [ADR-004 — Booking-to-Production Boundary](ADR-004-booking-to-production-boundary.md) — accepted architectural direction requiring reconciliation with completed BDRs before implementation.

ADR-001 contains the controlled register of required follow-up ADRs. Reserved numbers are planning references, not accepted decisions.

## Status convention

- Proposed
- Accepted
- Superseded
- Withdrawn

Every ADR should state context, decision, consequences, status and related upstream BDRs/schemas.
