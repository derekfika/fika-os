# Pack 7 BDR-to-Schema Traceability

## Mobilisation

| Schema element | Authority | Treatment |
|---|---|---|
| `mobilisationId` | MOB-001; Stage 5 governed clarification | Independent stable identity; multiple records may reference the same Operational Location over time. |
| `purpose`, `programmeType`, `scope` | Stage 5 governed clarification | Defines one governed establishment, material-change or re-establishment programme for an approved operating scope. |
| `governanceEntryReference` | MOB-001; Stage 5 governed clarification | Records the governed basis for the programme without inventing a materiality policy. |
| `operationalLocationId` | MOB-004; LOC-001; Stage 5 governed clarification | Optional stable Operational Location reference where that location is within scope. |
| `clientId`, contract and commercial-agreement references | MOB-003; Stage 5 governed clarification | Optional relationships only; no separate Client Mobilisation concept. |
| accountable organisational role | MOB-002; ROLE-002; Authority Model; Stage 5 governed clarification | Exactly one explicit accountable role for the governed scope. |
| authority grants and delegation references | MOB-002; Authority Model; Stage 5 governed clarification | Additional authority is explicit; delegation is scoped and effective-dated and does not transfer accountability. |
| coordinator assignment | MOB-002; ROLE-002 | Required day-to-day coordinator assignment. |
| effective period and outcome | Stage 5 governed clarification | Preserves each Mobilisation's timing, outcome and history independently. |

## Phase Plan

| Schema element | Authority | Treatment |
|---|---|---|
| workshop baseline reference | MOB-001 | Preserves MNK as workshop evidence rather than Canon. |
| phase references and sequence | MOB-001 | Structural plan without adopting phase names. |
| explicit optionality | MOB-001 | Every phase entry states whether its work is optional. |
| dependencies | MOB-001 supporting evidence | Explicit references without hardcoding the MNK sequence. |

## Task

| Schema element | Authority | Treatment |
|---|---|---|
| classification | MOB-004 | Mandatory, Capability-Conditional or Client/Operational-Location-Specific. |
| role ownership | MOB-002; ROLE-002 | Specialist responsibility remains role-based. |
| capability enablement reference | MOB-004; CAP-001 | Required for capability-generated tasks. |
| requirement reference | MOB-004 | Prevents specific work from entering the canonical task catalogue silently. |

## Readiness Assessment

| Schema element | Authority | Treatment |
|---|---|---|
| optional target date | MOB-003; Stage 5 governed clarification | Records a target when applicable without requiring a Client-contractual basis. |
| domain confirmations and evidence | MOB-003 | Each participating domain confirms its readiness using evidence. |
| `assessedBy` assignment and authority grant | MOB-002; MOB-003; Authority Model; Stage 5 governed clarification | Assessment authority is explicit and role-based, not inferred from management-group membership. |
| significant-risk escalation and mitigation | MOB-003 | Both references required for recorded significant risks. |
| Client-approved delay reference | MOB-003 | Optional evidence where the agreed opening target changes. |

## Repository dependency warning

Pack 7 references Pack 2 role, assignment and capability concepts. Their BDRs are repository-visible, but Pack 2 schemas are not currently present in the repository and are therefore referenced only by stable identity.
