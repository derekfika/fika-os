# ADR-003: Canonical Booking and Ingestion Adapters

> **Classification: Supporting proposed ADR.** Business discovery is now complete, but this ADR remains unadopted and must be reconciled with accepted BDRs and Stage 5 schemas.

## Status

Proposed — draft for review, not adopted.

## Context

Current hospitality systems accept bookings through direct public platforms and legacy Gmail/XLSX workflows. Direct MNK, Angel Court, CFC and Demo implementations already construct a common server booking object, but dashboards persist flattened Sheet rows and may reconstruct records from email, forms or `ParsedJSON`.

This creates competing representations, copied integration logic and inconsistent ownership of prices, charges and workflow status. MNK delivery charges are currently introduced downstream rather than being frozen by the authoritative submission-time pricing pipeline.

FIKA requires one canonical booking language without removing working legacy paths before equivalent behaviour is proven.

## Decision

If adopted, FIKA will:

1. Treat the Booking Platform as the authoritative creator of hospitality bookings.
2. Represent each authoritative record using the versioned `FikaBooking` contract.
3. Keep commercial booking status separate from dashboard workflow status.
4. Use optimistic concurrency with persisted `version`, `updatedAt`, `updatedBy` and mutation-time `expectedVersion`.
5. Freeze item prices, booking charges, tax and totals at submission/version time using integer minor units.
6. Calculate MNK delivery charges in the same server-authoritative pricing pipeline before persistence.
7. Publish canonical booking objects to Hospitality Dashboard consumers; Sheets remain operational projections or audit surfaces.
8. Make CPU and Logistics consume canonical/downstream objects rather than re-parsing forms or quotes when structured data exists.
9. Retain Angel Court email ingestion as a legacy adapter that outputs the canonical contract.
10. Require direct submissions to carry a submission ID or idempotency key, and legacy channels to carry stable source references.
11. Keep provider-specific values under source or integration metadata.
12. Use MNK as the preferred direct-platform reference while retaining independently deployable site configurations and genuine rule extensions.

## Canonical Flow

```text
Direct platform ──────────────┐
                              ├─> ingestion/validation/pricing ─> FikaBooking
Legacy email/form adapter ────┘                                  │
                                                                 ├─> Hospitality Dashboard projection
                                                                 ├─> CPU production projection
                                                                 └─> Logistics projection
```

## Consequences

### Positive

- One source of truth for booking identity, status, request and frozen prices.
- Legacy and direct channels converge without requiring an immediate rewrite.
- Dashboard, CPU and Logistics integrations can share stable contracts.
- Site differences move toward configuration and explicit policy adapters.
- Price, charge and acknowledgement decisions become auditable.
- Optimistic concurrency prevents silent stale overwrites.

### Costs and risks

- Current dashboard fields must be classified as canonical, workflow, integration, audit or projection state.
- Dashboard edits require a versioned write-back or overlay decision.
- Legacy form mappings need fixtures and explicit uncertainty handling.
- Existing pricing and downstream fee behaviour must be reconciled.
- Independent deployments need compatibility, migration and rollback controls.
- JSON Schema cannot enforce pricing arithmetic or status transitions alone.

## Alternatives Considered

### Keep each dashboard Sheet authoritative

Rejected for the target architecture because it preserves column-specific coupling, object reconstruction and competing truths.

### Recreate booking-form spreadsheets for every site

Rejected as the default because direct platforms already produce richer structured objects and future sites should not inherit legacy mechanics without an operational reason.

### Remove legacy email ingestion immediately

Rejected because Angel Court requires a working fallback and gradual migration must preserve business continuity.

### Put every dashboard field into FikaBooking

Rejected because operational workflow, UI, integration and audit state have different ownership from the commercial booking.

## Adoption Conditions

This ADR remains Proposed until:

- the draft schemas and field ownership are approved;
- status transitions, pricing arithmetic and edit ownership are defined;
- live MNK and Angel Court fixtures pass contract tests;
- the Angel Court adapter has regression fixtures;
- dashboard/CPU/Logistics consumer compatibility is demonstrated;
- migration and rollback plans are approved.

## Related Documents

- `docs/domain-models/fika-booking-v1.md`
- `schemas/fika-booking.schema.json`
- `inventory/reports/hospitality-booking-platform-family.md`
- `inventory/reports/hospitality-dashboard-family.md`
