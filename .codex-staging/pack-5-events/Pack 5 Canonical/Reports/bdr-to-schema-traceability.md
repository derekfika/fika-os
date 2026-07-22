# Pack 5 BDR-to-Schema Traceability

## Schema traceability

| Schema element | Authority | Treatment |
|---|---|---|
| Event boundary | EVT-001; SVC-008 | Event is bespoke and distinct from recurring Service schedules, Service Arrangements and Hospitality Booking. |
| `eventId` | Repository schema rules; SVC-008 domain ownership | Stable Event-domain identity. |
| `operationalLocationId` | EVT-001 | Required stable reference to the Operational Location where the Event is delivered. |
| `purpose` | SVC-008 | Event owns its own purpose. |
| `eventContact` | PACK5-GATE-002 | Exactly one identifiable person is responsible for Event communications. |
| optional `clientId` | PACK5-GATE-002 | References an existing Client only where applicable; Events without a Client remain valid. |
| `qualificationBasis.bespoke` | EVT-001 | Must be true. |
| `qualificationBasis.partOfRecurringServiceSchedule` | EVT-001 | Must be false. |
| optional `occasionDescription` | EVT-001 | Preserves the occasion-specific qualification context without replacing the mandatory Event Contact. |
| `serviceIds` | SVC-008 | Optional references to Services used, referenced or purchased. |
| `serviceArrangementIds` | SVC-008 | Optional references to supporting Service Arrangements. |
| `approval.approvingPersonId` | PACK5-GATE-001 | Identifies the approving person. |
| `approval.approvingAuthority` | PACK5-GATE-001; Authority Model | Identifies the organisational role or delegated authority. |
| `approval.decision` and `decidedAt` | PACK5-GATE-001 | Records the approval decision and timestamp. |
| optional `approval.conditions` | PACK5-GATE-001 | Records conditions where applicable. |
| provenance | AGENTS.md schema rules; documentation governance | Identifies governing BDRs and source snapshot. |
| audit/version fields | Cohesion Principles; Authority Model | Preserves accountable, auditable history rather than overwriting it. |

## Cross-pack dependencies

| Dependency | Status in this candidate |
|---|---|
| Operational Location identity | Referenced by stable ID; Pack 1 schema is not copied. |
| Client identity | Optional stable reference; Client remains owned by Pack 1. |
| Operational Relationship (OPREL) | Referenced as the Client-participation condition; not modelled by Pack 5. |
| Service identity | Referenced by stable ID; owned by Pack 3. |
| Service Arrangement identity | Referenced by stable ID; owned by Pack 3. |
| Role Assignment and Authority Grant | Referenced by stable ID; owned by Pack 2. |

## Unrepresented approved ownership

The Event domain owns planning, delivery and lifecycle, but their internal structures are not represented because Pack 5 authority does not define their required fields or lifecycle catalogue.
