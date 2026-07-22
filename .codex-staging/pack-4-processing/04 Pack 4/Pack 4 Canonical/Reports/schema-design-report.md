# Pack 4 Schema Design Report

Pack 4 contains seven Booking-domain Business Decision Records. The generated schemas are draft business contracts only. They are not database tables, APIs, UI models, provider payloads or adopted production schemas.

## Schemas generated

- `booking-amendment-action.schema.json`
- `booking-dietary-allergen-requirement.schema.json`
- `booking-item-quantity.schema.json`
- `booking-price-snapshot.schema.json`
- `booking-service-time.schema.json`
- `booking-source-reference.schema.json`
- `booking-vat-total.schema.json`

## Design notes

- BOOK-001 makes `serviceStartAt` required and leaves other timing fields optional.
- BOOK-002 preserves ordered quantity/unit separately from production conversion.
- BOOK-003 supports allergy/dietary disclosure evidence but does not invent a final allergen catalogue or person-allocation policy.
- BOOK-004 preserves immutable accepted price snapshots and explicit amendment versions.
- BOOK-005 models ex-VAT pricing, quote-total VAT calculation and round-up preference.
- BOOK-006 models audited amend/cancel/decline actions without defining unresolved risk thresholds.
- BOOK-007 keeps channel-neutral source references and explicitly keeps parser detail outside Booking.

## Unresolved business-detail questions retained

- Definitive unit catalogue and conversion rules must come from approved hospitality brochures and production processes.
- Exact person/group/item dietary-allergen reference requirements remain a future refinement if more precision is required.
- Higher-risk booking changes and required approval thresholds remain governed by role-based authority but are not enumerated here.
- Exact VAT rounding algorithm beyond the approved round-up preference may require Finance confirmation before adoption.
