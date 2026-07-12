# ADR-004: Booking-to-Production Boundary

> **Classification: Supporting accepted architectural direction.** The previously unresolved Booking and Production rules are now canonical decisions. Reconcile this ADR with their BDRs before schema or implementation work.

- Status: Accepted architectural direction; production-order schemas and implementation remain future work
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

## Historical unresolved decisions — now decided

The canonical decision register now contains these business answers. They remain listed here to preserve the ADR's original context until it is reconciled with accepted BDRs.

- TODO: Confirm which commercial booking statuses create, hold, update, cancel, or complete production work.
- TODO: Define required-ready, dispatch, arrival, handover, and service-time semantics and ownership.
- TODO: Confirm whether one booking can create multiple production orders or use multiple producing facilities.
- TODO: Define production units, yields, conversion rules, and their configuration ownership.
- TODO: Define dietary/allergen allocation from booking requirements to production lines.
- TODO: Define late amendment, cancellation, already-prepared, and correction workflows.
- TODO: Define the canonical production-order repository and delivery mechanism; storage is not decided by this ADR.

## Evidence

- `docs/domain-models/fika-booking-v1.md`
- `docs/decisions/ADR-003-canonical-booking-and-ingestion-adapters.md`
- `inventory/reports/hospitality-booking-platform-family.md`
- `inventory/reports/hospitality-dashboard-family.md`
- `inventory/reports/cpu-production-dashboard.md`
