# FikaBooking v1 Domain Model

## Status

**Draft for review — not adopted.**

Schema version represented by this draft: `1.0.0-draft.1`.

This document describes the proposed canonical hospitality booking boundary. It does not change production behaviour and is not permission to migrate existing records.

## Purpose

`FikaBooking` is the authoritative commercial record of a hospitality booking. It captures the request, submission-time customer and service details, frozen items and prices, source provenance, acknowledgements, validation outcome, and record concurrency metadata.

The intended information flow is:

```text
Booking Platform
        ↓
Canonical FikaBooking
        ↓
Hospitality Dashboard
        ↓
CPU Dashboard
        ↓
Logistics
```

The Booking Platform owns canonical creation. The Hospitality Dashboard is an operational consumer and may project the booking into Sheets. CPU and Logistics consume downstream views linked by stable booking ID and version.

## Source-of-Truth Guidance

- The persisted canonical booking object is authoritative for hospitality booking identity, commercial status, customer/service request, items, frozen prices, charges, dietary declarations, acknowledgements, and source provenance.
- A dashboard Sheet is an operational projection, not the canonical source.
- Booking Platform line-item and request-log Sheets may remain projections or audit logs.
- Gmail messages and booking-form spreadsheets are legacy source evidence, not canonical records.
- Angel Court may retain email ingestion through an adapter that emits this same contract.
- Quote, Calendar, CPU, Logistics, recharge, feedback and reporting records are downstream objects or workflow state unless a future decision explicitly moves a field into the booking domain.

## Status Ownership

### Canonical commercial status

The draft permits:

- `draft`
- `submitted`
- `acknowledged`
- `quoted`
- `confirmed`
- `cancelled`
- `declined`
- `completed`

The owner of each transition and the permitted transition graph remain unresolved.

### Dashboard workflow status

Operational statuses such as readiness, review, quote staleness, Calendar staleness, printing, recharge, scan state, validation UI state and archive presentation are not authoritative commercial status. They belong in dashboard workflow state, integration state, projections or audit records.

## Record Identity and Concurrency

Persisted records require:

- `bookingId`: stable canonical identity;
- `version`: monotonically increasing record version;
- `createdAt`, `createdBy`;
- `updatedAt`, `updatedBy`.

Every mutation command must carry `expectedVersion`. A mutation succeeds only when `expectedVersion` equals the stored `version`; success increments `version` and sets the new update metadata.

`expectedVersion` is command metadata and must not be stored inside the booking. The booking schema exposes a reusable `$defs.mutationConcurrency` definition for a future mutation-envelope schema.

TODO: Define conflict response, retry policy, immutable history, and whether status-only changes create a full booking version.

## Domain Boundaries

`FikaBooking` is the versioned aggregate record. `FikaBookingItem`, `FikaCharge`, the embedded `FikaCustomer` snapshot and `FikaServiceLocation` snapshot are value objects within that aggregate, not independently versioned records in this draft. Their shapes have `schemaVersion`; the aggregate root owns `version`, creation/update timestamps and actors. Item and charge instances have stable IDs within the booking. Customer-master and location-master IDs remain optional until those separate canonical records are defined.

If any supporting object later becomes an independently persisted aggregate, it will require its own record version and audit metadata rather than inheriting the booking's lifecycle implicitly.

### FikaBooking

Required in the draft:

- schema and record version;
- stable booking ID;
- canonical commercial status;
- stable site ID;
- source channel/system/references;
- customer/contact snapshot;
- service date/time/timezone/type and structured location;
- items collection, which may be empty only for a permitted bespoke enquiry;
- frozen pricing snapshot;
- structured dietary declaration;
- acknowledgements collection;
- validation result;
- creation/update actors and timestamps.

Optional in the draft:

- site display-name snapshot;
- commercial/invoice/PO/cost-centre reference;
- service end time;
- onsite contact;
- special instructions;
- non-provider-specific metadata.

### FikaBookingItem

Each line has a stable `bookingItemId`. A resolved `catalogueItemId` is optional so legacy unmapped lines can be represented honestly.

Required line snapshot:

- category label and item name;
- quantity;
- price type, currency, unit price and line total in minor units.

Optional line snapshot:

- catalogue/version/category IDs;
- description and serving information;
- service time;
- choices;
- comments;
- minimum and notice snapshots;
- validation outcome;
- source/integration metadata.

### FikaCustomer

The embedded object is a submission-time customer/contact snapshot. Contact name, email, phone and organisation are required because all current direct platforms require them.

`customerId` is optional until customer matching, ownership and deduplication rules exist. The booking-specific commercial reference does not belong in the customer master object.

### FikaServiceLocation

The model retains `displayLabel` for operational use and adds structured fields for location type, building, floor, room/area, delivery point and address.

`serviceLocationId` is optional until authoritative site/location records exist. `siteId` links a location snapshot to the stable site where known.

### FikaCharge

Booking-level charges use these canonical types:

- `management_fee`
- `delivery`
- `labour`
- `equipment`
- `service_charge`
- `discount`
- `other`

Discount amounts are zero or negative; all other charges are zero or positive. Charges record tax treatment and may retain a calculation-policy version.

MNK delivery charges must be calculated by the server-authoritative pricing pipeline before persistence, not introduced later only in the dashboard projection.

## Money and Frozen Pricing

All monetary values are integers in currency minor units. Currency is an uppercase ISO 4217 code. For GBP, `1250` means £12.50.

The booking freezes:

- each item's name/description/serving and catalogue version where available;
- each item's unit and line total;
- catalogue and pricing-policy versions;
- all booking-level charges;
- taxable amounts, tax rates and tax amounts;
- item subtotal, charge total, net total, tax total and gross total;
- calculation actor and timestamp.

Required arithmetic invariants, which JSON Schema alone cannot enforce:

```text
itemSubtotalMinor = sum(items[*].priceSnapshot.lineTotalMinor)
chargeTotalMinor = sum(charges[*].amountMinor)
netTotalMinor = itemSubtotalMinor + chargeTotalMinor
taxTotalMinor = sum(taxLines[*].taxAmountMinor)
grossTotalMinor = netTotalMinor + taxTotalMinor
```

Currency must match across the booking pricing snapshot, items and charges.

TODO: Define rounding, mixed tax rates, tax-inclusive prices, item-level discounts, refunds and price amendments after submission.

## Source and Idempotency

The canonical record uses a provider-neutral source envelope.

Direct platform submissions require `submissionId` or `idempotencyKey`. Legacy email/form sources require at least one stable source reference. Supported reference types include submission ID, idempotency key, email message/thread ID, attachment hash and external record ID.

Provider-specific data may appear only under `source.integrationMetadata`. Credentials and secrets are prohibited.

TODO: Decide the canonical idempotency-key algorithm, uniqueness scope, expiry, and cross-channel duplicate rules.

## Acknowledgements

Each verified acknowledgement records:

- stable acknowledgement ID;
- acknowledgement type;
- policy version;
- acceptance timestamp;
- stable accepting actor/customer reference;
- wording snapshot where the exact wording is legally or operationally important.

Legacy sources must not fabricate acceptance. When a form lacks verifiable evidence, the acknowledgement array may be empty and validation must record the missing evidence. Whether such bookings may progress to `confirmed` is a business decision.

## Validation

Validation status is `valid`, `needs_review` or `invalid`. Issues have a stable code, severity, message and optional field path.

Validation is not the commercial status. A `submitted` booking may require review without acquiring a dashboard-specific authoritative status.

TODO: Separate immutable submission validation from rules that are recalculated after a policy change.

## Ingestion Adapters

### Direct Booking Platform

MNK is the preferred baseline. The server:

1. accepts IDs, quantities, choices and request fields;
2. resolves current catalogue entries;
3. calculates all item prices, charges and tax;
4. validates policies;
5. persists the canonical booking using an idempotency key;
6. publishes a dashboard projection.

### Angel Court legacy email adapter

The adapter should:

1. retain stable Gmail/attachment references under `source`;
2. parse the form into customer, service, items, dietaries and instructions;
3. resolve catalogue IDs where evidence allows;
4. preserve unmapped item wording and legacy price snapshots;
5. record missing acknowledgements or mapping uncertainty as validation issues;
6. persist the same canonical object;
7. publish through the same dashboard ingestion contract.

Booking-form spreadsheets should not be recreated for new sites unless a specific operational requirement is approved.

## Fields Deliberately Excluded

- Dashboard row number and spreadsheet column names
- Dashboard-only readiness, stale, print, archive or recharge statuses
- Synthetic Gmail fields created only to satisfy current dashboard columns
- Quote and Calendar UI state that belongs to their own objects/workflows
- Branding, logos, hero copy, recipients and deployment identifiers
- Raw menu sort order and presentation-only layout data
- Demo feedback result
- Credentials, tokens or secrets

## Existing Production Fields Not Safely Mapped

The following existing concepts need further ownership decisions before they enter a canonical schema:

- `READY`, `NEEDS_REVIEW`, quote-generated, CPU-created, recharged and similar dashboard statuses;
- `dashboardProcessed`, `quoteCreated`, `calendarCreated`, `kitchenPrinted` booleans;
- quote/Calendar URL, ID, stale, printed, removed and timestamp fields;
- flattened `ServiceTimes` when multiple item times exist;
- free-text `Location`, `Floor` and notes reconstructed from several fields;
- `MessageId`, `ThreadId`, `AttachmentName`, source subject/from and The Line fingerprint/revision fields;
- `ItemsJSON`, `ParsedJSON` and nested `clientBooking` duplication;
- MNK recharge destination/formula state;
- feedback request/response metadata;
- parser warnings whose immutability and recalculation policy are unclear.

These values may map to source metadata, integration metadata, workflow state, separate canonical objects, audit events or projections. No final placement is asserted.

## Unresolved Questions

1. What is the permitted commercial status-transition graph, and which workflow owns each transition?
2. Do dashboard edits create a new authoritative booking version or an operational overlay?
3. What durable store owns canonical booking JSON before a future storage decision?
4. What is the idempotency uniqueness scope across site, source channel and time?
5. How are customer and service-location IDs resolved and governed?
6. What are the exact pricing, tax and rounding rules, including mixed rates and amendments?
7. Should charges be booking-only, or can they target specific items?
8. How should refunds, credits and post-confirmation changes be represented?
9. Which acknowledgement wording must always be snapshotted?
10. Which legacy records may progress without acknowledgements?
11. Which quote, Calendar and audit links belong on the booking versus separate objects?
12. What personal-data retention and redaction rules apply to source metadata and fixtures?

## Draft Adoption Gate

Before this draft can be adopted:

- resolve the questions above;
- approve field names and ownership with operational stakeholders;
- add mutation-envelope and status-transition schemas;
- add arithmetic/business-rule validation beyond JSON Schema;
- add regression fixtures for live MNK and Angel Court direct paths and supported legacy form layouts;
- verify dashboard, CPU and Logistics consumption contracts;
- define migration, compatibility and rollback behaviour.
