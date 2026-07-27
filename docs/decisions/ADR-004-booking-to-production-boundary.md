# ADR-004: Booking-to-Production Boundary

> **Classification: Supporting accepted architectural direction, reconciled by [ADR-009](ADR-009-booking-to-production-orchestration.md).** This record preserves the earlier boundary decision and historical context. ADR-009 governs the current orchestration contract where this record is incomplete.

- Status: Accepted supporting direction; reconciled by ADR-009 on 2026-07-27
- Date: 2026-07-11

## Context

The Hospitality Booking Platform is the authoritative source of hospitality bookings. The target flow is:

```text
Booking Platform
  -> Canonical Booking Object
  -> Hospitality Dashboard
  -> CPU
  -> Logistics
```

The CPU Production Dashboard currently discovers hospitality work through Calendar events. It prefers an attached booking JSON object, but can reconstruct facts from quotes, legacy booking forms, event titles, descriptions, locations, and ownership mappings. It stores a normalised CPU Orders Sheet and maintains preparation state, warnings, change indicators, and photographic evidence.

This current projection mixes facts received from a booking with production workflow and integration metadata. The draft `FikaBooking` v1 model must not absorb CPU-specific state simply because the current CPU application stores them together.

## Decision

1. `FikaBooking` represents authoritative commercial and service intent: booking identity and version, commercial status, customer, site, service timing and location, requested items, instructions, dietary requirements, acknowledgements, and frozen pricing.
2. CPU readiness, attention, preparation state, chef attribution, production evidence, parser warnings, and production completion are not part of `FikaBooking`.
3. Production work will be represented by a future, separately versioned `FikaProductionOrder`, with production lines represented by a corresponding production-line contract.
4. Future workflows will transform an eligible canonical booking version into one or more production orders through an explicit, versioned transformation.
5. Calendar-led ingestion remains a transitional adapter. It may continue to discover or reconstruct current work while canonical ingestion is introduced and verified.
6. CPU Orders, CPU Deliveries, and related Sheets remain operational projections and audit/supporting views. They are not canonical booking or production-order records.
7. Integration references and parser evidence remain outside domain records except through deliberately defined source or audit metadata.

## Boundary guidance

`FikaBooking` owns what was commercially requested and agreed. `FikaProductionOrder` will own what must be produced, where, when, and under which production rules. Dashboard workflow state owns how operational users are progressing that work. Integration metadata owns how records were received, projected, retried, or reconciled.

The production transformation must retain the source booking ID and version. It must define idempotency, amendment ordering, cancellation behaviour, and traceability back to booking items before replacing current adapters.

## Consequences

- The booking schema remains free of CPU-specific status and preparation fields.
- Production quantities, units, yields, category/work-centre routing, preparation notes, and production disposition belong in the future production model.
- Existing Calendar, quote, and booking-form adapters remain supported during gradual migration.
- Direct canonical consumption can be introduced alongside current ingestion and compared before cutover.
- CPU Sheets may continue to support operational views without becoming authoritative records.
- A canonical booking change does not silently overwrite production work; an explicit production amendment or disposition policy is required.

## Historical questions and current disposition

These questions are retained to preserve the ADR's original context. Canonical BDRs and ADR-009 now govern their disposition.

- **Partly resolved:** PROD-001 defines Production eligibility, but the exact Booking-status trigger and hold prerequisites remain business-policy questions.
- **Resolved at the current governed minimum:** BOOK-001 and PROD-002 separate customer-facing service time from mandatory Production Required Ready Time; additional milestones remain deferred.
- **Resolved:** PROD-005 permits one Booking to create one or more Production Orders and makes Production responsible for routing to capable Operational Locations.
- **Resolved:** BOOK-002 and PROD-003 separate ordered quantities from Production-owned conversion, yield, aggregation and preparation quantities.
- **Partly resolved:** BOOK-003 requires dietary and allergen requirements to flow into fulfilment, while the exact allocation rule remains a business-policy question.
- **Resolved at the architectural boundary:** BOOK-006, PROD-004 and ADR-009 preserve amendment and cancellation history and require human review after Production has started; detailed disposition policy remains deferred.
- **Resolved architecturally:** ADR-006 defines the logical canonical repository boundary and ADR-009 defines the delivery and recovery contract without selecting storage or transport.

## Reconciliation with ADR-009

ADR-009 preserves this record's core separation while replacing its incomplete transformation wording with an explicit cross-domain orchestration contract. Booking remains authoritative for commercial and service intent. Production independently evaluates eligibility and owns zero, one or several Production Orders. Orchestration coordinates attributable versions, outcomes, retries and reconciliation without owning either domain's facts. Calendar-led ingestion and CPU Sheets remain legacy observations or operational projections during controlled coexistence.

## Evidence

- `docs/domain-models/fika-booking-v1.md`
- `docs/decisions/ADR-003-canonical-booking-and-ingestion-adapters.md`
- `inventory/reports/hospitality-booking-platform-family.md`
- `inventory/reports/hospitality-dashboard-family.md`
- `inventory/reports/cpu-production-dashboard.md`
