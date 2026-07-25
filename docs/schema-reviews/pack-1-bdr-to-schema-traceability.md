# Pack 1 BDR-to-Schema Traceability Matrix

## Status

**Draft traceability artefact — not an adoption record.** It maps the Accepted and Frozen Pack 1 business authority to Draft schemas without changing the BDRs.

## Cross-cutting compilation rules

| Schema feature | Authority | Application |
|---|---|---|
| JSON Schema Draft 2020-12, versioned `$id`, `schemaVersion` | `AGENTS.md`; Stage 5; Platform Principles | Applied to every schema |
| Stable identifier properties | `AGENTS.md`; Platform Principles; CLIENT-001 and LOC-001 | Required for every record or history item |
| ISO 8601 date-time formats | `AGENTS.md`; Platform Principles; LOC-004, LOC-005 and TYPE-003 | Used for Pack 1 record and history times |
| `additionalProperties: false` | Platform Principles; Stage 5 traceability requirement | Prevents unapproved fields from silently becoming canonical |
| Draft labels and Draft URNs | Stage 5; schema repository conventions | Every new schema remains unadopted |

## Schema-to-BDR map

| Schema | Governing BDRs | Ownership represented |
|---|---|---|
| Client | CLIENT-001 | Client stable organisational identity |
| Client Contact | CLIENT-001 | Individual identity separate from Client |
| Client/OPLOC Relationship (`client-operational-location-relationship.schema.json`) | CLIENT-001, LOC-005 | Independent, historically traceable relationship |
| Client Contact OPLOC Assignment | CLIENT-001, LOC-005 | Contact responsibility across OPLOCs |
| Operational Location | LOC-001–LOC-004, LOC-006, TYPE-001–TYPE-003 | Durable OPLOC identity and owned current/history facts |
| Operational Location Alias | LOC-002, LOC-003 | Historical aliases without changing identity |
| OPLOC Lifecycle Transition | LOC-004 | Approved, retained lifecycle change |
| Location Type | TYPE-001, TYPE-002 | Operations-owned governed catalogue entry |
| Location Type Assignment | TYPE-001–TYPE-003 | One effective-dated primary Type and its history |
| Change Approval | LOC-004, TYPE-001, TYPE-003 | Minimum role-based Pack 1 approval evidence |

## Property and constraint traceability

### Client

| Properties or constraint | Authority |
|---|---|
| `clientId` | CLIENT-001 stable business identity |
| `approvedName` | CLIENT-001 external-organisation identity |
| `version`, `createdAt`, `updatedAt` | Platform Principles applied to CLIENT-001 identity |
| No embedded Contacts or OPLOCs | CLIENT-001; LOC-005 |

### Client Contact

| Properties or constraint | Authority |
|---|---|
| `clientContactId`, `displayName` | CLIENT-001 separate individual identity |
| `clientId` | CLIENT-001 association with Client |
| `version`, `createdAt`, `updatedAt` | Platform Principles applied to CLIENT-001 identity |
| No email, phone or retention fields | Authority missing; deliberately excluded |

### Client and Operational Location Relationship

| Properties or constraint | Authority |
|---|---|
| `relationshipId`, `clientId`, `operationalLocationId` | CLIENT-001; LOC-005 |
| `relationshipKind` | LOC-005 separates primary commercial Client from stakeholder organisations |
| `role` | LOC-005 requires the relationship to have its own role |
| `effectiveFrom`, `effectiveTo` | LOC-005 changing relationships and retained history |
| `sourceReference` | LOC-005 provenance requirement |
| At most one open primary commercial relationship | LOC-005; cross-record workflow constraint |

### Client Contact Operational Location Assignment

| Properties or constraint | Authority |
|---|---|
| `assignmentId`, `clientContactId`, `operationalLocationId` | CLIENT-001 permits responsibilities across OPLOCs |
| `responsibility` | CLIENT-001 operational, commercial or administrative responsibilities |
| `effectiveFrom`, `effectiveTo`, `sourceReference` | LOC-005 history and provenance |
| No closed responsibility enum | Authority missing; deliberately free text in Draft |

### Operational Location

| Properties or constraint | Authority |
|---|---|
| `operationalLocationId` | LOC-001 durable identity |
| `approvedName` | LOC-002; LOC-003 |
| `accountableInternalOwnerReference` | CLIENT-001 requires an accountable internal owner even without an external Client; Canon Authority Model requires role-based authority |
| `lifecycleState` | LOC-004 decommission, reactivate and merge mechanics |
| `mergedIntoOperationalLocationId` | LOC-004 permanent survivor reference |
| `aliases` | LOC-003 historical aliases |
| `lifecycleHistory` | LOC-004 retained, approved transitions |
| `currentLocationTypeAssignment`, `locationTypeHistory` | TYPE-001–TYPE-003 |
| `version`, `createdAt`, `updatedAt` | Platform Principles applied to LOC-001 identity |
| Merged requires survivor; non-merged forbids survivor | LOC-004 |
| Exactly one open current Type assignment | TYPE-001–TYPE-003 |
| No address or specialist-domain fields | LOC-003; LOC-006 |

### Operational Location Alias

| Properties or constraint | Authority |
|---|---|
| `aliasId`, `name` | LOC-003 historical aliases |
| `recordedAt`, optional effective interval | LOC-003 history; Platform Principles |
| Optional `reason`, `sourceReference` | Pack 1 history/traceability requirement; policy unresolved |

### Operational Location Lifecycle Transition

| Properties or constraint | Authority |
|---|---|
| `transitionId`, `fromState`, `toState`, `effectiveAt` | LOC-004 retained transition history |
| `active`, `decommissioned`, `merged` | LOC-004 reactivation, decommission and merge |
| `approval` required | LOC-004 senior management approval for every transition |

### Location Type

| Properties or constraint | Authority |
|---|---|
| `locationTypeId`, `name`, `definition` | TYPE-001 catalogue; TYPE-002 operating-model meaning |
| `catalogueState` active/retired | TYPE-001 governed retirement without deletion |
| `changeHistory` | TYPE-001 additions, renames and retirements; Canon history principle |
| Change `add`, `rename`, `retire` and approval | TYPE-001 material-change approval |
| Site and Venue as records, not schema enum | TYPE-002 current Types; TYPE-001 governed catalogue change |
| `version`, `createdAt`, `updatedAt` | Platform Principles applied to catalogue governance |

### Location Type Assignment

| Properties or constraint | Authority |
|---|---|
| `assignmentId`, `operationalLocationId`, `locationTypeId` | TYPE-001 mandatory Type; TYPE-002 one primary Type |
| `previousLocationTypeId` | TYPE-003 records what changed; initial assignment omits it |
| `effectiveFrom`, `effectiveTo` | TYPE-003 effective-dated history |
| `approval` | TYPE-003 who authorised and why; TYPE-001 governance |
| Exactly one assignment without `effectiveTo` per OPLOC | TYPE-002; TYPE-003 |

### Change Approval

| Properties or constraint | Authority |
|---|---|
| `approvalId`, `approvedAt` | LOC-004 and TYPE-003 approval history |
| `authorityRole` | TYPE-001 role-based authority; Canon Authority Model |
| Optional `actorReference` | TYPE-003 records who authorised; actor contract unresolved |
| `reason` | LOC-004 and TYPE-003 require why |
| Optional `sourceReference` | Pack 1 provenance support; exact contract unresolved |
| No named-person enum or universal audit payload | TYPE-001; LOC-003; Audit domain not adopted |

## Unresolved schema questions and missing authority

| Question | Missing or ambiguous authority | Smallest governed resolution |
|---|---|---|
| Is `active/decommissioned/merged` the complete lifecycle catalogue? | LOC-004 confirms mechanics but defers full states | Amend LOC-004 or add lifecycle-catalogue BDR |
| How are physical addresses referenced and governed? | LOC-003 excludes address master data; LOC-006 defines boundary only | New address-boundary/reference BDR |
| What stable actor/source-reference contracts apply? | TYPE-001 is role-based; no adopted User/Audit schema | Governance-reference or later User/Audit BDR |
| Are the two Client relationship classifications sufficient? | LOC-005 establishes separation, not a complete catalogue | Clarifying LOC-005 amendment if closure is required |
| Which Client Contact personal fields and retention rules are canonical? | CLIENT-001 defines identity only | Client Contact privacy/retention BDR |
| Must approved-name changes always become aliases, and who approves them? | LOC-003 owns aliases but no workflow policy | OPLOC naming-history BDR |
| What evidence is mandatory for duplicate detection and merge? | LOC-004 lists possible evidence but no minimum | Merge-evidence BDR |
| Are additional classifications distinct from OPCAPs? | TYPE-002 permits them but does not define them | Classification-boundary BDR |

## Deliberate exclusions

CLORG, OPREL, COMAG, OPLOC Group, a detailed OPCAP catalogue, CPU, Food Production and Food Safety are not represented as schemas or properties. They lack Accepted Pack 1 authority.
