# Stage 5 Schema Pack Roadmap

## Purpose

This roadmap divides Stage 5 into dependency-ordered review packs. It is a governance and sequencing plan, not a schema definition, implementation roadmap or adoption record.

All packs follow the [Schema Generation and Approval Process](platform-methodology/schema-generation-and-approval-process.md). A pack may be planned from Draft BDRs, but generation and adoption must satisfy the BDR entry gates stated in that process.

## Status vocabulary

- **Approval status:** Not submitted, Under Review, Approved or Adopted.
- **Completion status:** Planned, In progress, Complete or Blocked.

“Complete” means the pack's Stage 5 deliverables are complete; “Adopted” requires a separate explicit adoption record.

## Pack summary

| Pack | Scope | Depends on | Review owner | Approval status | Completion status |
|---|---|---|---|---|---|
| 1 | Shared primitives; Client; Client Contact; Operational Location; Alias; Ownership; Type | Accepted CLIENT, LOC and TYPE BDRs | Derek / Commercial and Derek / Operations; schema reviewer TODO | Not submitted | Blocked — relevant BDRs remain Draft |
| 2 | Capabilities; Configuration; Roles; Responsibilities; Assignments; Permissions | Pack 1; accepted CAP, CFG and ROLE BDRs | Relevant BDR decision owners; schema reviewer TODO | Not submitted | Blocked — Pack 1 and BDR review |
| 3 | Service; Recurring Schedule; Service Arrangement; Service Occurrence | Packs 1–2; accepted SVC BDRs | Derek / Operations and relevant Service owners; schema reviewer TODO | Not submitted | Blocked — dependencies and BDR review |
| 4 | Booking | Packs 1–3; accepted BOOK BDRs | Derek / Hospitality and relevant Booking owners; schema reviewer TODO | Not submitted | Blocked — dependencies and BDR review |
| 5 | Events | Packs 1–3; accepted EVT BDRs | Derek / Events owner; schema reviewer TODO | Not submitted | Blocked — dependencies and BDR review |
| 6 | Production | Packs 1–4; accepted PROD BDRs | Derek / Production / Hospitality; schema reviewer TODO | Not submitted | Blocked — dependencies and BDR review |
| 7 | Mobilisation | Packs 1–3 where referenced; accepted MOB BDRs | Derek / Mobilisation owner; schema reviewer TODO | Not submitted | Blocked — dependencies and BDR review |
| 8 | Brand; Waste | Pack 1; Pack 2 configuration where referenced; accepted BRAND and WASTE BDRs | Derek / Brand owner and Derek / Operations; schema reviewer TODO | Not submitted | Blocked — dependencies and BDR review |
| 9 | Provider mappings | Adopted canonical schemas from applicable packs | Provider/integration owners TODO | Not submitted | Blocked — canonical schema adoption |

## Pack 1 — Foundational identity and location

### Purpose

Establish the shared primitives and stable organisational/place identities that later packs reference: Client, Client Contact, Operational Location, Operational Location Alias, Operational Location Ownership and Operational Location Type.

### Dependencies

- Accepted CLIENT-001, LOC-001–006 and TYPE-001–003 BDRs.
- Shared primitive decisions must be traceable to existing BDRs; any missing business meaning returns to discovery/BDR governance.

### Expected deliverables

- Draft domain schemas and explanatory domain-model guidance for the named concepts.
- Property-level BDR traceability.
- Explicit identity, ownership, relationship, cardinality, lifecycle and effective-history rules.
- Valid and invalid fictional fixtures.
- Validation evidence and completed review checklists.
- Approval and adoption records when the relevant gates are passed.

### Review owner

Derek / Commercial for Client meaning and Derek / Operations for Operational Location meaning. **TODO:** name the standing schema reviewer/adoption authority.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked pending acceptance of the relevant Draft BDRs

## Pack 2 — Capability, configuration and authority

### Purpose

Express Operational Capability, configuration, Roles, Responsibilities, Assignments and Permissions without merging capability, configuration and authority into one concept.

### Dependencies

- Pack 1 identities and ownership relationships.
- Accepted CAP-001–004, CFG-001–003 and ROLE-001–007 BDRs.

### Expected deliverables

- Schemas and guidance for each named concept and their explicit relationships.
- Inheritance, effective-history and scope representation where required by BDRs.
- Valid/invalid fixtures, validation evidence and review/adoption records.

### Review owner

Relevant BDR decision owners. **TODO:** confirm a single coordinating review owner and adoption authority.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by Pack 1 and BDR review

## Pack 3 — Service

### Purpose

Define Service, Service Arrangement, Recurring Schedule and Service Occurrence as distinct but related business concepts.

### Dependencies

- Pack 1 Operational Location and Client relationships.
- Pack 2 configuration, capability and assignment concepts where referenced.
- Accepted SVC-001–010 BDRs.

### Expected deliverables

- Schemas and domain guidance for the four named concepts.
- Explicit scope, ownership, lifecycle, effective-dated schedule and occurrence relationships.
- Valid/invalid fixtures, validation evidence and review/adoption records.

### Review owner

Derek / Operations and the relevant Service decision owners. **TODO:** confirm the coordinating owner.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by Packs 1–2 and BDR review

## Pack 4 — Booking

### Purpose

Reconcile the existing draft booking evidence with accepted Booking and upstream Service decisions, then define the canonical commercial and service-intent record without absorbing production or dashboard workflow state.

### Dependencies

- Packs 1–3.
- Accepted BOOK-001–007 BDRs.
- Reconciliation of the existing draft FikaBooking material and formal review as supporting evidence only.

### Expected deliverables

- Booking and booking-item schema set and domain guidance.
- Amendment, cancellation, price-snapshot, source-reference, quantity/unit, dietary/allergen, VAT and totals representation supported by BDRs.
- Valid/invalid fixtures, validation evidence, compatibility assessment and review/adoption records.

### Review owner

Derek / Hospitality and relevant Booking decision owners. **TODO:** confirm the coordinating schema reviewer.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by Packs 1–3 and BDR review

## Pack 5 — Events

### Purpose

Define the Event domain boundary and governance while preserving its distinctions from Service Occurrences and Bookings.

### Dependencies

- Packs 1–3.
- Accepted EVT-001–002 and related SVC BDRs.

### Expected deliverables

- Event schema and domain guidance.
- Explicit qualification, ownership and relationships to upstream concepts.
- Valid/invalid fixtures, validation evidence and review/adoption records.

### Review owner

Derek / Events owner. **TODO:** confirm named business and schema reviewers.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by dependencies and BDR review

## Pack 6 — Production

### Purpose

Define production intent and lines separately from the commercial Booking while preserving transformation, amendment, unit, yield and routing meaning.

### Dependencies

- Packs 1–4.
- Accepted PROD-001–005 and related BOOK BDRs.

### Expected deliverables

- Production Order and production-line schema set and domain guidance.
- Explicit eligibility, linkage, timing, units, yields, aggregation, amendments, cancellations and routing.
- Valid/invalid fixtures, validation evidence and review/adoption records.

### Review owner

Derek / Production / Hospitality and relevant Production decision owners. **TODO:** confirm the coordinating schema reviewer.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by Packs 1–4 and BDR review

## Pack 7 — Mobilisation

### Purpose

Express the governed mobilisation journey, ownership, readiness and task classification without turning one historical plan into a universal schema by inference.

### Dependencies

- Pack 1 identities and locations; Pack 3 where service readiness is referenced.
- Accepted MOB-001–004 BDRs.

### Expected deliverables

- Mobilisation, phase/readiness and task-related schemas or value objects justified by BDRs.
- Explicit optionality, ownership, dependencies and history.
- Valid/invalid fixtures, validation evidence and review/adoption records.

### Review owner

Derek / Mobilisation owner. **TODO:** confirm the coordinating schema reviewer.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by dependencies and BDR review

## Pack 8 — Brand and Waste

### Purpose

Define Brand variation/override meaning and the separate Waste domain without implying that they form one aggregate. They share a delivery pack only for manageable Stage 5 sequencing.

### Dependencies

- Pack 1 Operational Location.
- Pack 2 Configuration where Brand variation references it.
- Accepted BRAND-001 and WASTE-001 BDRs.

### Expected deliverables

- Separate Brand and Waste schema/domain guidance.
- Brand approval and override relationships supported by BDRs.
- Waste event, quantity, reason, location and outcome concepts supported by BDRs; unresolved measurement detail must return to business governance.
- Valid/invalid fixtures, validation evidence and separate review/adoption records.

### Review owner

Derek / Brand owner for Brand; Derek / Operations for Waste. **TODO:** confirm schema reviewers.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked by dependencies and BDR review

## Pack 9 — Provider mappings

### Purpose

Map external and legacy source models into adopted canonical schemas without allowing providers to define FIKA business meaning.

### Dependencies

- Adopted canonical schemas from the relevant Packs 1–8.
- [Provider Mapping Principles](platform-methodology/provider-mapping-principles.md).
- Confirmed provider contracts and named mapping owners.

### Expected deliverables

- Versioned mapping specifications for Square, BrightHR, Google Workspace, Goodtill, legacy systems, email ingestion and future providers only where an adopted schema and evidenced need exist.
- Fictional inbound/outbound mapping fixtures, provenance rules and validation evidence.
- Documented loss, ambiguity, rejection and version-change behaviour.

### Review owner

Relevant domain owner plus provider/integration owner. **TODO:** name owners per mapping.

### Status

- **Approval status:** Not submitted
- **Completion status:** Blocked pending canonical schema adoption

## Roadmap governance

- Update pack status only through an explicit review, approval or adoption action.
- Do not mark a pack Complete merely because draft files exist.
- A pack may be split if review scope becomes too broad, but dependencies and traceability must be retained.
- Cross-pack discoveries that change business meaning return to the BDR process.
- Provider mapping cannot be used to accelerate or redefine a canonical pack.

