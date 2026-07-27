# Pack 1 Draft Schemas

> **Current authority:** These component schemas are part of the completed, integrated and adopted Stage 5 Packs 1–8 baseline. The title and original Draft wording below preserve their pre-adoption review history and do not create a new adoption gate.

## Status

**Historical processing status:** Draft — not adopted at the time this Pack was prepared. The schemas were subsequently validated, integrated and adopted through the Stage 5 closure on 2026-07-25. Frozen business authority remains unchanged.

## Scope

Pack 1 covers Client, Client Contact, Operational Location (OPLOC), approved-name aliases, lifecycle transitions and merges, the Location Type catalogue, primary Location Type assignments, and the minimum historically traceable Client/Contact relationships authorised by Pack 1.

## Catalogue

| Schema | Purpose | Governing BDRs |
|---|---|---|
| `client.schema.json` | Stable external-organisation identity | CLIENT-001 |
| `client-contact.schema.json` | Separate individual Client Contact identity | CLIENT-001 |
| `client-operational-location-relationship.schema.json` | Effective-dated Client-to-OPLOC relationship | CLIENT-001, LOC-005 |
| `client-contact-operational-location-assignment.schema.json` | Effective-dated Client Contact responsibility at an OPLOC | CLIENT-001, LOC-005 |
| `operational-location.schema.json` | Durable OPLOC identity and current/historical state | LOC-001–LOC-004, LOC-006, TYPE-001–TYPE-003 |
| `operational-location-alias.schema.json` | Preserved historical or alternative name | LOC-002, LOC-003 |
| `operational-location-lifecycle-transition.schema.json` | Approved lifecycle transition history | LOC-004 |
| `location-type.schema.json` | Governed Location Type catalogue entry | TYPE-001, TYPE-002 |
| `location-type-assignment.schema.json` | Effective-dated primary Type assignment | TYPE-001–TYPE-003 |
| `change-approval.schema.json` | Minimum role-based approval evidence needed by Pack 1 histories | LOC-004, TYPE-001, TYPE-003 |

## Boundary choices

- Client, Client Contact and OPLOC are separate identities.
- Client and Contact relationships are separate records; they are not embedded in OPLOC.
- The OPLOC owns only stable identity, approved name, aliases, lifecycle and its primary Location Type assignment/history.
- Address master data, branding, providers, configuration, menus, pricing, equipment, staffing, calendars, bookings, events, services and capabilities are excluded.
- Location Types are catalogue records referenced by stable ID. Site and Venue are confirmed catalogue entries represented in fixtures, not a permanently closed schema enum.
- `active`, `decommissioned` and `merged` are the minimum Draft lifecycle mechanics supported by LOC-004. They are not presented as a complete future lifecycle catalogue.

## Additional-property policy

Every Pack 1 schema uses `additionalProperties: false`. Pack 1 is a governed compilation of accepted business knowledge, so unknown fields must fail validation rather than silently become canonical. A new property requires BDR traceability and schema review. Provider payloads, application metadata and speculative extension bags are deliberately excluded.

## Fixtures and validation

Non-production fixtures are under [`fixtures/pack-1`](../../fixtures/pack-1). Run:

```text
python scripts/validate-pack-1-schemas.py
```

The local validation environment requires the `jsonschema` package. The command checks Draft 2020-12 schema structure, reference resolution, format constraints, valid fixtures, deliberately invalid fixtures and the small cross-record invariants documented in the validator.

## Traceability and review

- [Pack 1 BDR-to-schema traceability matrix](../../docs/schema-reviews/pack-1-bdr-to-schema-traceability.md)
- [Pack 1 schema design report](../../docs/schema-reviews/pack-1-schema-design-report.md)
- [Stage 5 — Schema Design](../../docs/stages/stage-5-schema-design.md)

## Adoption blockers

- Confirm whether the minimal lifecycle values are sufficient or require another BDR.
- Confirm the authoritative address-domain/reference boundary.
- Confirm actor and source-reference contracts for approval evidence.
- Confirm whether the Client/OPLOC relationship classifications are the intended minimum.
- Confirm personal-data fields, ownership and retention before extending Client Contact.
- Confirm catalogue-change history requirements beyond additions, renames and retirement.
