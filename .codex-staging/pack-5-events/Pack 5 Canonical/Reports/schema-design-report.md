# Pack 5 Schema Design Report

Pack 5 produces one narrow draft Event schema from EVT-001, EVT-002 and the accepted SVC-008 boundary.

The schema is a fixed human-review candidate. It is not adopted, not an implementation model and not authorised for repository integration.

## Represented meaning

- Stable Event identity.
- Delivery at one Operational Location.
- Bespoke Event-specific purpose.
- Exactly one mandatory Event Contact responsible for confirmations, updates and operational correspondence.
- Optional Client reference where an approved Operational Relationship applies.
- Explicit exclusion from recurring Service schedules.
- Optional references to Services and Service Arrangements without ownership transfer.
- Auditable approval record identifying person, organisational role or delegated authority, decision, timestamp and optional conditions.
- Provenance, record version and audit history.

## Deliberately excluded

- Lifecycle status values.
- Publication status or publication approval.
- Hospitality Booking fields.
- Service or Service Arrangement ownership.
- Provider, application, storage or dashboard fields.
- Event planning and delivery sub-models whose structures are not governed.

## Governed gate resolutions

Every canonical Event requires an auditable approval record. No separate Governance Evidence concept has been introduced.

Customer terminology has been replaced by Event Contact. Event Contact is mandatory; Client is optional. OPREL is referenced as the condition for Client participation but is not modelled by Pack 5.

## Deferred business decisions

- Lifecycle status catalogue and transition authority.
- Publication approval rules and authority.
- Approval, notification and escalation thresholds.
- Additional approval-evidence requirements.
- Detailed OPREL modelling.

## Validation

- Schema files: 1
- Valid fixtures passed: 2
- Invalid fixtures failed as expected: 4
- Failures: 0
