# Business Decision Records

## Purpose

Business Decision Records (BDRs) preserve approved FIKA business meaning in the repository. They explain context, rationale, consequences and relationships without changing the human-approved decision wording.

BDRs are distinct from Architectural Decision Records in [`docs/decisions`](../decisions/README.md). A BDR governs business meaning; an ADR governs a reviewed architectural choice that implements upstream business authority.

## Current status

Stage 4 is active. All **54 canonical decisions** have generated BDRs: **1 Accepted** and **53 Draft**. The canonical decisions are accepted; each explanatory BDR remains Draft until human repository review.

## Authority and source

The [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) remains the approved decision source while the Draft BDRs are reviewed. Every Decision section preserves the approved answer exactly, ignoring non-semantic leading or trailing cell whitespace.

## Naming

- Use the existing Question/Decision identifier followed by a concise slug: `loc-001-operational-location.md`.
- Do not create a second numbering sequence.
- Retain the workbook's existing `DEC-…` register identifier inside the BDR for traceability.
- Do not reuse an identifier after supersession.

## Statuses

- `Draft` — generated and mechanically checked against the workbook; explanatory sections have not yet been human-reviewed
- `Proposed` — explanatory content reviewed and awaiting decision-owner acceptance
- `Accepted` — approved as the durable repository record
- `Superseded` — replaced by a named later BDR
- `Withdrawn` — deliberately removed before acceptance

## Generation and review rules

1. Copy the canonical answer exactly into the Decision section.
2. Read the linked evidence and related canonical decisions.
3. Add context and rationale only where evidence supports them.
4. Use `TODO` rather than infer missing consequences or trade-offs.
5. Cross-link dependencies and direct dependants.
6. Validate that all 54 identifiers appear once and only once.
7. Do not update schemas, architecture or code during BDR generation.
8. Change a BDR to Accepted only after human review of its explanatory sections.

## Template

Use [`000-template.md`](000-template.md) for future records. The filename is retained as a template marker only; it is not a BDR identifier.

## Draft BDR index

### Booking

- [BOOK-001 — Booking Service Time](book-001-booking-service-time.md) — Draft
- [BOOK-002 — Booking Item Quantities and Units](book-002-booking-item-quantity-units.md) — Draft
- [BOOK-003 — Dietary and Allergen Requirements](book-003-dietary-allergen-references.md) — Draft
- [BOOK-004 — Immutable Pricing and Amendments](book-004-immutable-pricing-amendments.md) — Draft
- [BOOK-005 — VAT, Rounding and Totals](book-005-vat-rounding-totals.md) — Draft
- [BOOK-006 — Booking Amendments, Cancellations and Declines](book-006-booking-amendment-cancellation-decline.md) — Draft
- [BOOK-007 — Booking Source References](book-007-booking-source-references.md) — Draft

### Brand

- [BRAND-001 — Brand and White-Labelling Overrides](brand-001-brand-overrides.md) — Draft

### Client

- [CLIENT-001 — Client and Client Contact Definition](client-001-client-definition.md) — Accepted

### Configuration

- [CFG-001 — Configuration Ownership](cfg-001-configuration-ownership.md) — Draft
- [CFG-002 — Configuration Inheritance](cfg-002-configuration-inheritance.md) — Draft
- [CFG-003 — Configuration Variation and Approval](cfg-003-configuration-variation-approval.md) — Draft

### Events

- [EVT-001 — Event Qualification Boundary](evt-001-event-qualification.md) — Draft
- [EVT-002 — Event Governance](evt-002-event-governance.md) — Draft

### Mobilisation

- [MOB-001 — Canonical Mobilisation Journey](mob-001-mobilisation-journey.md) — Draft
- [MOB-002 — Mobilisation Ownership](mob-002-mobilisation-ownership.md) — Draft
- [MOB-003 — Mobilisation Readiness](mob-003-mobilisation-readiness.md) — Draft
- [MOB-004 — Mobilisation Task Classification](mob-004-mobilisation-task-classification.md) — Draft

### Operational Capability

- [CAP-001 — Operational Capability Definition](cap-001-operational-capability-definition.md) — Draft
- [CAP-002 — Capability Optionality and Dependencies](cap-002-capability-optionality-dependencies.md) — Draft
- [CAP-003 — Capability Overrides](cap-003-capability-overrides.md) — Draft
- [CAP-004 — Capability, Domain and Permission Boundary](cap-004-capability-domain-permission-boundary.md) — Draft

### Operational Location

- [LOC-001 — Operational Location Definition](loc-001-operational-location.md) — Draft
- [LOC-002 — Operational Location Name](loc-002-operational-location-name.md) — Draft
- [LOC-003 — Operational Location Ownership Boundary](loc-003-operational-location-boundary.md) — Draft
- [LOC-004 — Operational Location Lifecycle](loc-004-operational-location-lifecycle.md) — Draft
- [LOC-005 — Client and Operational Location Relationships](loc-005-client-operational-location-relationships.md) — Draft
- [LOC-006 — Operational Location Building and Address Boundary](loc-006-single-building-address.md) — Draft
- [TYPE-001 — Location Type Requirement and Ownership](type-001-location-type-requirement.md) — Draft
- [TYPE-002 — Primary Location Type](type-002-primary-location-type.md) — Draft
- [TYPE-003 — Location Type History](type-003-location-type-history.md) — Draft

### Production

- [PROD-001 — Production Order Eligibility](prod-001-production-order-eligibility.md) — Draft
- [PROD-002 — Booking and Production Timing](prod-002-booking-production-timing.md) — Draft
- [PROD-003 — Production Units, Yields and Aggregation](prod-003-production-units-yields.md) — Draft
- [PROD-004 — Production Amendments and Cancellations](prod-004-production-amendments-cancellations.md) — Draft
- [PROD-005 — Multi-Facility Production Routing](prod-005-multi-facility-production-routing.md) — Draft

### Roles and Permissions

- [ROLE-001 — Role Catalogue Ownership](role-001-role-catalogue-ownership.md) — Draft
- [ROLE-002 — Roles, Responsibilities, Assignments and Authority](role-002-roles-responsibilities-assignments.md) — Draft
- [ROLE-003 — Permission Action Vocabulary](role-003-permission-actions.md) — Draft
- [ROLE-004 — Assignment Scopes](role-004-assignment-scopes.md) — Draft
- [ROLE-005 — Approval and Publication Separation](role-005-approval-publication-separation.md) — Draft
- [ROLE-006 — Access Boundaries](role-006-access-boundaries.md) — Draft
- [ROLE-007 — Emergency Access](role-007-emergency-access.md) — Draft

### Service

- [SVC-001 — Service Definition](svc-001-service-definition.md) — Draft
- [SVC-002 — Service Terminology](svc-002-service-terminology.md) — Draft
- [SVC-003 — Production and Training Domain Boundary](svc-003-production-training-domain-boundary.md) — Draft
- [SVC-004 — Service Arrangement Scope](svc-004-service-arrangement-scope.md) — Draft
- [SVC-005 — Recurring Schedule Governance](svc-005-recurring-schedule-governance.md) — Draft
- [SVC-006 — Service Occurrence and Booking Boundary](svc-006-service-occurrence-booking-boundary.md) — Draft
- [SVC-007 — Wise Service Arrangements](svc-007-wise-service-arrangements.md) — Draft
- [SVC-008 — Service and Event Boundary](svc-008-service-event-boundary.md) — Draft
- [SVC-009 — Coffee Cart Model](svc-009-coffee-cart-model.md) — Draft
- [SVC-010 — Service Commercial Ownership](svc-010-service-commercial-ownership.md) — Draft

### Waste

- [WASTE-001 — Waste as a Business Domain](waste-001-waste-domain.md) — Draft
