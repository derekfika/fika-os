# Pack 8 Schema Design Report

Pack 8 contains four Draft review candidates across two independent domains. It does not create a combined Brand/Waste aggregate.

## Brand Variation

The candidate records one deliberate variation from approved FIKA branding, its business scope and basis, documented presentation elements, at least one Brand Assurance Record reference, separate Marketing and Brand approval references, effective period, provenance and audit history.

It deliberately does not define Brand assets, Media records, application themes, design tokens or provider payloads.

The candidate uses the narrow Client, Operational Location and Service scopes and the three bases supported by BRAND-001. It does not broaden ownership to applications or presentation consumers.

## Brand Assurance Record

The record identifies the proposed Brand Variation, applicable Brand Standard, what was verified, the reviewing assignment, time, optional evidence references, provenance and audit history. It records assurance rather than authorisation and introduces no additional approval-workflow concept.

## Waste Event

The candidate records one food or operational Waste event, its Operational Location, occurrence time, positive quantity with an Operations-owned Measurement Catalogue reference, reason, Waste Disposition reference, recording assignment, provenance and audit history.

It deliberately does not own source Service, Booking, Event, Production or financial records. It contains no reporting metrics, disposal catalogue, provider fields or application workflow state.

Measurement Catalogue values are not hardcoded and remain deferred.

## Waste Disposition

The record identifies the immediate operational outcome of one Waste Event, when and by which assignment it was recorded, provenance and audit history. The deferred Improvement Action domain is not embedded or modelled.

## Shared structural rules

- JSON Schema Draft 2020-12.
- Stable identity and explicit Draft schema version.
- `additionalProperties: false`.
- ISO 8601 dates and timestamps.
- Role-assignment-based attribution.
- Provenance and attributable audit history.
- Fictional fixtures only.

## Human Decision Gates

All three gates are resolved. See `../Human Decision Required.md`, retained as the governed resolution record.
