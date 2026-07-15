# Stage 5 Schema Pack Roadmap

## Purpose

This roadmap divides Stage 5 into dependency-ordered schema Packs. It is a governance and sequencing plan, not a schema definition, implementation roadmap or completion record.

All Packs follow the [Schema Generation and Completion Process](platform-methodology/schema-generation-and-approval-process.md). Missing business meaning returns to a Human Decision Gate; deterministic completion continues through repository integration.

## Status vocabulary

- **Repository status:** Not started, Staged, Integrated or Committed.
- **Completion status:** Planned, In progress, Complete or Blocked.

“Complete” means the Pack's Stage 5 deliverables are complete and integrated. `READY FOR COMMIT` means Git commit is the sole remaining manual engineering action.

## Pack summary

| Pack | Scope | Depends on | Business authority | Repository status | Completion status |
|---|---|---|---|---|---|
| 1 | Shared primitives; Client; Client Contact; Operational Location; Alias; Ownership; Type | Governed CLIENT, LOC and TYPE BDRs | Relevant Client and Operations business owners | Integrated | Complete; ready for commit |
| 2 | Capabilities; Configuration; Roles; Responsibilities; Assignments; Permissions | Pack 1; governed CAP, CFG and ROLE BDRs | Relevant BDR business owners | Integrated | Complete; ready for commit |
| 3 | Service; Recurring Schedule; Service Arrangement; Service Occurrence | Packs 1–2; governed SVC BDRs | Operations and relevant Service owners | Integrated | Complete; ready for commit |
| 4 | Booking | Packs 1–3; governed BOOK BDRs | Hospitality and relevant Booking owners | Integrated | Complete; ready for commit |
| 5 | Events | Packs 1–3; governed EVT BDRs | Events business owner | Integrated | Complete; ready for commit |
| 6 | Production | Packs 1–4; governed PROD BDRs | Production and Hospitality business owners | Integrated | Complete; ready for commit |
| 7 | Mobilisation | Packs 1–3 where referenced; governed MOB BDRs | Mobilisation business owner | Integrated | Complete; ready for commit |
| 8 | Brand; Waste | Pack 1; Pack 2 configuration where referenced; governed BRAND and WASTE BDRs | Brand and Operations business owners | Integrated | Complete; ready for commit |
| 9 | Provider mappings | Completed and integrated canonical schemas from applicable Packs | Relevant domain owner plus provider/integration owner | Not started | Blocked only by first provider selection and accountable owner |

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
- Completion and repository-integration records.

### Business authority

Relevant Client, Commercial and Operations business owners.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

## Pack 2 — Capability, configuration and authority

### Purpose

Express Operational Capability, configuration, Roles, Responsibilities, Assignments and Permissions without merging capability, configuration and authority into one concept.

### Dependencies

- Pack 1 identities and ownership relationships.
- Accepted CAP-001–004, CFG-001–003 and ROLE-001–007 BDRs.

### Expected deliverables

- Schemas and guidance for each named concept and their explicit relationships.
- Inheritance, effective-history and scope representation where required by BDRs.
- Valid/invalid fixtures, validation evidence and completion records.

### Business authority

Relevant Capability, Configuration, Role and Permission business owners.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

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
- Valid/invalid fixtures, validation evidence and completion records.

### Business authority

Operations and the relevant Service business owners.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

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
- Valid/invalid fixtures, validation evidence, compatibility assessment and completion records.

### Business authority

Hospitality and the relevant Booking business owners.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

## Pack 5 — Events

### Purpose

Define the Event domain boundary and governance while preserving its distinctions from Service Occurrences and Bookings.

### Dependencies

- Packs 1–3.
- Accepted EVT-001–002 and related SVC BDRs.

### Expected deliverables

- Event schema and domain guidance.
- Explicit qualification, ownership and relationships to upstream concepts.
- Valid/invalid fixtures, validation evidence and completion records.

### Business authority

The Events business owner.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

## Pack 6 — Production

### Purpose

Define production intent and lines separately from the commercial Booking while preserving transformation, amendment, unit, yield and routing meaning.

### Dependencies

- Packs 1–4.
- Accepted PROD-001–005 and related BOOK BDRs.

### Expected deliverables

- Production Order and production-line schema set and domain guidance.
- Explicit eligibility, linkage, timing, units, yields, aggregation, amendments, cancellations and routing.
- Valid/invalid fixtures, validation evidence and completion records.

### Business authority

Production, Hospitality and relevant Production business owners.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

## Pack 7 — Mobilisation

### Purpose

Express the governed mobilisation journey, ownership, readiness and task classification without turning one historical plan into a universal schema by inference.

### Dependencies

- Pack 1 identities and locations; Pack 3 where service readiness is referenced.
- Accepted MOB-001–004 BDRs.

### Expected deliverables

- Mobilisation, phase/readiness and task-related schemas or value objects justified by BDRs.
- Explicit optionality, ownership, dependencies and history.
- Valid/invalid fixtures, validation evidence and completion records.

### Business authority

The Mobilisation business owner.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

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
- Valid/invalid fixtures, validation evidence and separate completion records.

### Business authority

The Brand business owner for Brand and Operations business owner for Waste.

### Status

- **Repository status:** Integrated
- **Completion status:** Complete; ready for commit

## Pack 9 — Provider mappings

### Purpose

Map external and legacy source models into completed, integrated canonical schemas without allowing providers to define FIKA business meaning.

### Dependencies

- Completed and integrated canonical schemas from the relevant Packs 1–8.
- [Provider Mapping Principles](platform-methodology/provider-mapping-principles.md).
- Confirmed provider contracts and named mapping owners.

### Expected deliverables

- Versioned mapping specifications for Square, BrightHR, Google Workspace, Goodtill, legacy systems, email ingestion and future providers only where a completed, integrated schema and evidenced need exist.
- Fictional inbound/outbound mapping fixtures, provenance rules and validation evidence.
- Documented loss, ambiguity, rejection and version-change behaviour.

### Business authority

Relevant domain owner plus provider/integration owner. **TODO:** name owners per mapping.

### Status

- **Repository status:** Not started
- **Completion status:** Blocked only by first provider selection and accountable owner

## Roadmap governance

- Update Pack status through deterministic completion and repository integration.
- Do not mark a pack Complete merely because draft files exist.
- A pack may be split if review scope becomes too broad, but dependencies and traceability must be retained.
- Cross-pack discoveries that change business meaning return to the BDR process.
- Provider mapping cannot be used to accelerate or redefine a canonical Pack.
