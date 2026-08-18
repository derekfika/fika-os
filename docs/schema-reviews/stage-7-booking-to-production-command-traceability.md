# Stage 7 Booking-to-Production Command Traceability

**Date:** 2026-07-27
**Status:** Draft evidence for authority review; not adopted

This matrix traces the draft [Booking-to-Production Command schema](../../schemas/stage-7/booking-to-production-command.schema.json). It does not alter Pack 4 Booking or Pack 6 Production authority.

## Requirement matrix

| Requirement | Schema location | Fixture evidence | Application/orchestration validation | Production validation | AUTHMOD validation | Authority | Classification |
|---|---|---|---|---|---|---|---|
| Contract identity and independent version | `schemaVersion`, `contract` | All valid; unsupported-version invalid | Select supported version before dispatch | Reject unsupported version | None | ADR-005; schema-versioning standard | Schema-enforced |
| Immutable command identity | `commandId` | All valid; missing-identities invalid | Enforce uniqueness and replay history | Reject conflicting reuse | None | ADR-005, ADR-009 | Schema plus runtime |
| Provisional operation | `operation` | Initial, amendment and cancellation valid | Map accepted Booking change to one operation | Decide whether operation is permitted | Verify initiating authority where needed | ADR-009 | Schema vocabulary; approval pending |
| Exact accepted Booking identity/version | `bookingIntent.bookingId`, `acceptedBookingVersion` | All valid | Read an accepted authoritative Booking version | Evaluate current/previously handled version | None | BOOK-001, BOOK-002, ADR-004, ADR-009 | Schema plus runtime |
| Idempotency | `idempotencyKey` | All valid; identifier invalid | Same logical intent must reuse key | Preserve prior outcome; reject changed intent | None | ADR-005, ADR-009 | Runtime history |
| Correlation and causation | `orchestration.*` | All valid | Create attributable lineage | Preserve lineage in outcomes | None | ADR-005, ADR-009 | Schema-enforced presence |
| Issuer and actor context | `authorityContext` | All valid | Supply governed service/actor references | Validate requester | Resolve assignments and grants | ADR-008, ADR-009 | Runtime authority |
| Service commitment and destination | `bookingIntent.serviceCommitment` | All valid; invalid time/timezone | Supply accepted commitment | Check fulfilment usability | None | BOOK-001, BOOK-006, ADR-009 | Schema plus business validation |
| Booking Item lineage | `bookingIntent.items[].bookingItemId` | All valid; missing item identity invalid | Preserve exact identity | Retain lineage in Production Lines | None | BOOK-003, PROD-002, ADR-004 | Schema-enforced presence |
| Ordered quantity without invented unit | `orderedQuantity` | Known/unresolved valid; invented unresolved unit invalid | Preserve quantity and uncertainty | Derive Production quantity/unit | None | BOOK-003, PROD-002, ADR-009 | Schema plus Production transformation |
| Item choices | `items[].choices` | Initial/amendment valid | Preserve governed choices | Interpret only under Production rules | None | BOOK-003, ADR-009 | Structure; semantics governed |
| Dietary/allergen minimisation | `dietaryInformationStatus`, `dietaryRequirementReferences` | Initial/amendment valid | Supply governed references/status | Resolve only necessary data | Enforce access | BOOK-003, ADR-009 | Business/privacy decision pending |
| Sanitised instructions only | `sanitisedInstructions` | Initial valid | Sanitise before dispatch | Accept purpose-limited content | Enforce sensitive access | ADR-008, ADR-009 | Flag plus runtime sanitisation |
| Amendment/cancellation lineage | `bookingChange`, conditionals | Change fixtures valid; missing lineage invalid | Supply accepted action/prior version | Apply current-state/concurrency rules | Validate change authority | BOOK-002, BOOK-007, PROD-004, ADR-009 | Schema plus runtime |
| Provenance and source specification | `provenance` | All valid | Record source contracts and lineage | Preserve acceptance evidence | None | ADR-005, ADR-009 | Schema-enforced presence |
| Warnings, uncertainties and exclusions | Root arrays and item uncertainties | All valid | Never silently default | Hold/reject where unsafe | None | ADR-005, ADR-009 | Structure; disposition pending |
| No caller-created Production identity/state | Strict schema; no Production fields | unknown-production-identity invalid | Never originate Order/Line identity | Production alone creates outcomes | None | PROD-001â€“005, ADR-004, ADR-009 | Schema exclusion |
| No commercial/personal payload by default | Strict `bookingIntent` | commercial/personal-fields invalid | Minimise before dispatch | Reject unnecessary fields | Enforce purpose/access | ADR-008, ADR-009 | Schema exclusion |
| Structural resource bounds | Array/string maxima; pre-parse annotation | Schema validation completed | Enforce byte/depth before parsing | Enforce bounded processing | None | Engineering standards | Provisional safety control |
| Out-of-order, duplicate and conflicting replay | Not expressible in one instance | Valid initial is replay baseline | Persist command/idempotency history | Compare versions and prior outcomes | None | ADR-006, ADR-009 | Runtime-only |
| Zero, one or many Production Orders | No outcome fields | All command fixtures | Do not predict outcome | Decide eligibility and create outcomes | Apply authority if required | PROD-001, ADR-009 | Production-owned outcome |

## Fixture index

Valid examples cover an initial accepted Booking, accepted amendment and accepted cancellation. Invalid examples cover unsupported versions, absent identities/provenance, missing Booking Item identity, prohibited Production identity, prohibited commercial/personal fields, malformed identifiers/timezone, missing cancellation lineage and an invented unit where the unit is unresolved.

Replay conflicts, out-of-order versions, duplicate command IDs, authority denial, hold policy and Production eligibility require state or business authority and therefore cannot be proven by single-instance JSON Schema validation.

## Conclusion

The draft has traceable structural coverage for the bounded command envelope. Adoption remains blocked by the authority decisions in the contract review. Pack 6 schemas and fixtures remain unchanged.
