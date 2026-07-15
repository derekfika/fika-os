# Pack 4 Schema Design Report

Pack 4 generates seven draft Booking-domain business schemas from the local repository BDRs BOOK-001 through BOOK-007.

These schemas are draft business contracts only. They are not database tables, APIs, UI models, provider payloads or adopted production schemas.

## Schemas generated

- `booking-amendment-action.schema.json`
- `booking-dietary-allergen-requirement.schema.json`
- `booking-item-quantity.schema.json`
- `booking-price-snapshot.schema.json`
- `booking-service-time.schema.json`
- `booking-source-reference.schema.json`
- `booking-vat-total.schema.json`

## Design boundaries

- BOOK-001 requires `serviceStartAt`; other service-adjacent times remain optional.
- BOOK-002 separates ordered quantity/unit from production conversion and production quantity.
- BOOK-003 models customer-facing disclosure obligations without inventing a definitive allergen catalogue.
- BOOK-004 models immutable accepted price snapshots and amendment versions.
- BOOK-005 models ex-VAT pricing, quote-total VAT calculation and round-up preference.
- BOOK-006 models audited amendment, cancellation and decline actions without inventing approval thresholds.
- BOOK-007 models channel-neutral source references and keeps parser detail outside Booking.

## Deferred business decisions

- Definitive supported unit catalogue and conversion-rule catalogue.
- Exact allergen/dietary allocation granularity for person, group and item references.
- Higher-risk booking-change thresholds and approval rules.
- Exact VAT rounding algorithm beyond the approved preference to round up.

## Validation

- Valid fixtures passed: 7
- Invalid fixtures failed as expected: 7
- Failures: 0
