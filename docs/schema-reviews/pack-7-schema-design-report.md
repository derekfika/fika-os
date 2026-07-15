# Pack 7 Schema Design Report

Pack 7 produces four narrow Draft Mobilisation schemas from MOB-001 through MOB-004 and their referenced role, capability and Operational Location authority.

## Schemas

### Mobilisation

Owns one governed programme of establishment, material change or re-establishment, its approved operating scope, purpose, effective period, outcome, accountable organisational role, explicit AUTHMOD authority references, coordinator assignment and links to its phase plan, tasks and readiness assessment. Client, contract and commercial-agreement references are optional.

### Mobilisation Phase Plan

Records ordered phase references, dependencies and explicit optionality. It references a workshop baseline and deliberately does not promote MNK-derived phase names into Canon.

### Mobilisation Task

Represents Mandatory, Capability-Conditional and Client/Operational-Location-Specific work. Each task has a role owner, dependencies and a source requirement appropriate to its classification.

### Mobilisation Readiness Assessment

Records domain confirmations, supporting evidence, assessment through an explicit role assignment and AUTHMOD authority grant, significant-risk escalation and mitigation, and any applicable Client-approved delay reference.

## Deliberately excluded

- A canonical MNK phase-name catalogue.
- A definitive mandatory-task catalogue.
- A readiness-evidence type catalogue.
- Task workflow statuses or completion percentages.
- Provider, spreadsheet or application fields.
- Named-person permanent ownership.
- A separate Client Mobilisation concept.
- A separate production-facility or other implementation-specific location concept.

## Governed decisions applied

- Each Mobilisation has one explicitly accountable organisational role; additional authority is represented through explicit assignments and AUTHMOD grants.
- Delegation is scoped and effective-dated and does not transfer accountability.
- Client, contract and commercial-agreement references are optional.
- Mobilisation has an independent stable identity and may repeat for one Operational Location without overwriting history.
- MNK-derived phase names remain workshop evidence and are not promoted into Canon.

## Validation

- Schema files: 4
- Valid fixtures passed: 4
- Invalid fixtures failed as expected: 4
- Failures: 0
