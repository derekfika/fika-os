# Pack 1 Schema Design Report

## Status

**Draft design report — no schema is adopted.** Pack 1 BDRs remain Accepted and Frozen; this work compiles them for human schema review without changing business meaning.

## Purpose

The first Pack 1 schema draft establishes a storage-independent contract for Client, Client Contact, Operational Location, Location Type and the minimum governed relationships and histories required by their Accepted BDRs.

## Schemas created

Ten Draft 2020-12 schemas were created under [`schemas/pack-1`](../../schemas/pack-1/README.md):

1. Client
2. Client Contact
3. Client and Operational Location Relationship
4. Client Contact Operational Location Assignment
5. Operational Location
6. Operational Location Alias
7. Operational Location Lifecycle Transition
8. Location Type
9. Location Type Assignment
10. Change Approval

## Principal modelling choices

### Independent identities and relationships

Client, Client Contact and OPLOC remain separate records. Effective-dated relationship and assignment records preserve changing involvement without embedding Client master data in an OPLOC or promoting OPREL.

### Narrow Operational Location aggregate

OPLOC contains only stable identity, current approved name, aliases, lifecycle, merge-survivor reference, current primary Location Type assignment and retained Type/lifecycle histories. Data owned by providers or specialist domains is excluded.

### Location Type as governed catalogue data

Location Type is modelled as a stable catalogue record, not a permanently closed JSON Schema enum. This honours Operations ownership and controlled additions, renames and retirement. Site is demonstrated in a safe fixture; Venue is equally representable without changing the schema.

### Current state plus history

The OPLOC exposes its current primary Location Type assignment for simple queries and retains every effective-dated assignment. Lifecycle transitions and aliases are also preserved. The validator checks the small cross-record invariants that JSON Schema cannot express alone.

### Minimal approval primitive

Change Approval records time, authority role, optional actor reference, reason and optional provenance. It is scoped to Pack 1 and is explicitly not a universal Audit event.

### Closed additional-property policy

`additionalProperties: false` prevents implementation, provider or generic CRM fields from entering the canonical draft without traceability and review.

## Fields and relationships

The complete property-level authority mapping is in the [traceability matrix](pack-1-bdr-to-schema-traceability.md). Stable references connect records; no storage join, database key or provider identifier is assumed.

## Fixtures and validation

The fixture set contains eleven valid examples—at least one for every schema plus both confirmed Site and Venue catalogue entries—and seven deliberately invalid examples covering:

- embedded Client Contacts;
- retired Type without retirement history;
- Type assignment without approval;
- Client/OPLOC relationship without provenance;
- OPLOC without a current Type;
- OPLOC merged into itself;
- two simultaneous current primary Types.

Validation is provided by [`scripts/validate-pack-1-schemas.py`](../../scripts/validate-pack-1-schemas.py). It checks schema syntax, references, formats, expected valid/invalid outcomes and Pack 1 semantic invariants.

## Unresolved questions

1. Full OPLOC lifecycle catalogue and transition rules.
2. Address-domain ownership and reference shape.
3. Stable actor and provenance-reference contracts.
4. Client relationship classification completeness and cross-record primary uniqueness enforcement.
5. Client Contact personal fields, privacy and retention.
6. Approved-name change workflow and mandatory alias behaviour.
7. Minimum duplicate/merge evidence.
8. Meaning and ownership of TYPE-002 additional classifications.

These are adoption blockers where they affect a final contract. The Draft omits speculative fields and proposes the smallest required BDR clarification in the traceability matrix.

## Discovery concepts excluded

The draft deliberately excludes CLORG, OPREL, COMAG, OPLOC Group, a detailed OPCAP catalogue, CPU, Food Production and Food Safety. No excluded candidate has been promoted indirectly through an extension field or schema name.

## Adoption position

The schemas are suitable for structured human review, not adoption or implementation. Review should start with business boundaries, then history and governance, then technical validation. No production migration or application implementation is authorised.

## Validation results

Local validation passed on 2026-07-13:

- 10 Draft 2020-12 schemas passed structural validation and reference resolution;
- 11 valid fixtures passed;
- 7 deliberately invalid fixtures were rejected as expected;
- Pack 1 semantic checks passed.
