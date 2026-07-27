# Logical Domain Service Catalogue

## Status and use

This is a Stage 6 logical catalogue governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md) and its accepted follow-up decisions through [ADR-009](../decisions/ADR-009-booking-to-production-orchestration.md). “Service” here means a software responsibility boundary. It must not be confused with the canonical business concept **Service** governed by SVC-001.

The catalogue defines no deployment topology and no API. Illustrative commands and queries are responsibility tests, not implementation specifications.

## Governed services

### Client Service

- Purpose: protect the stable identity of an external organisation, its Contacts and governed OPLOC relationships.
- Owns: Client, Client Contact and relationship history.
- Does not own: Operational Location identity, Booking, access policy or commercial workflow not governed by Pack 1.
- Depends on: Operational Location references and authority context.
- Evidence: CLIENT-001, LOC-005–006 and Pack 1 schemas.
- Candidate interactions: establish a Client; record a Contact; start/end a relationship; resolve current relationships.

### Operational Location Service

- Purpose: protect the durable identity and history of one Operational Location.
- Owns: approved name, aliases, lifecycle, Location Type catalogue assignments and governed transitions.
- Does not own: address master data, brand, equipment, staffing, applications, Services, Bookings or Events.
- Depends on: authority context; references Client relationships without owning them.
- Evidence: LOC-001–006, TYPE-001–003 and Pack 1 schemas.
- Candidate interactions: establish, rename, classify, transition and resolve history.

### Authority and Assignment Service

- Purpose: evaluate and preserve organisational roles, responsibilities, assignments and scoped AUTHMOD grants.
- Owns: the governed records defined by ROLE-001–007 and Pack 2.
- Does not own: authentication provider identity, domain records, capability enablement or business ownership held by another domain.
- Depends on: governed scope references.
- Evidence: ROLE-001–007 and Pack 2 schemas.
- Candidate interactions: assign/revoke, grant/revoke, evaluate action, record approval/publication, govern emergency access.

### Operational Capability Service

- Purpose: maintain the organisation-wide catalogue and effective availability of reusable business abilities.
- Owns: catalogue entries, dependency rules, enablement and capability overrides.
- Does not own: the meaning and lifecycle rules supplied by the owning domain, roles, authority grants or application features.
- Depends on: owning domains, Configuration and AUTHMOD.
- Evidence: CAP-001–004 and Pack 2 schemas.
- Candidate interactions: register approved capability, validate combination, enable/disable and resolve effective state.

### Configuration Service

- Purpose: resolve effective governed configuration through explicitly approved scope relationships.
- Owns: configuration records and their effective-dated inheritance/variation history.
- Does not own: business meaning, secrets, permission grants or a universal scope-precedence rule.
- Depends on: owning domain, AUTHMOD and applicable capability rules.
- Evidence: CFG-001–003 and Pack 2.
- Candidate interactions: define, authorise variation, expire and explain resolution.

### Service Domain Service

- Purpose: govern durable Services and the way each is delivered at an Operational Location.
- Owns: Service, Service Arrangement, Recurring Schedule, schedule exceptions and Service commercial-ownership records.
- Does not own: Booking, Event, Production, Training or a provider schedule.
- Depends on: Operational Location, Capability and AUTHMOD; may reference Event.
- Evidence: SVC-001–010 and Pack 3 schemas.
- Candidate interactions: define Service, establish Arrangement, revise schedule and record exception.

### Booking Service

- Purpose: govern commercial and service intent from request through approved changes and closure.
- Owns: Booking aggregate, items, customer/service details, source references, pricing snapshots and amendment/cancellation/decline history.
- Does not own: dashboard workflow, parser internals, provider payloads or Production state.
- Depends on: Service/Arrangement where applicable, OPLOC and party references, AUTHMOD.
- Evidence: BOOK-001–007, ADR-003, Pack 4 and earlier draft Booking review.
- Candidate interactions: submit, acknowledge, quote/confirm where governed, amend, cancel, decline and retrieve version history.
- Unresolved: the earlier aggregate schema requires later reconciliation with the Pack 4 component schemas; no schema change is made here.

### Event Service

- Purpose: govern bespoke Event identity, qualification, planning references and approval record.
- Owns: Event purpose, Event Contact, optional Client reference, qualification and approval evidence.
- Does not own: recurring Service work, Hospitality Booking, publication policy or Calendar/provider records.
- Depends on: OPLOC, Service, optional Client and AUTHMOD.
- Evidence: EVT-001–002, Pack 5 resolution and Event schema.
- Candidate interactions: propose, qualify, approve, amend and retrieve.
- Unresolved: lifecycle states and publication policy.

### Production Service

- Purpose: govern operational fulfilment work derived from eligible Booking demand.
- Owns: Production Orders, Lines, routing allocations, preparation quantities/rules and Production change history.
- Does not own: customer-facing Booking state, a separate Production Facility concept or Logistics state.
- Depends on: attributable Booking version, OPLOC, Production capability and AUTHMOD.
- Evidence: PROD-001–005, Pack 6 resolution, Pack 6 schemas and ADR-004.
- Candidate interactions: create from eligible Booking, plan, start, complete, route and handle change.

### Mobilisation Service

- Purpose: govern a distinct programme that establishes, materially changes or re-establishes an approved operating scope.
- Owns: Mobilisation, accountable role, scope, plan, tasks, readiness assessment, effective period, outcome and history.
- Does not own: routine operational change, a mandatory Client contract or MNK phase names as Canon.
- Depends on: governed scope, AUTHMOD, Capabilities and optional Client/OPLOC references.
- Evidence: MOB-001–004, Pack 7 resolution and schemas.
- Candidate interactions: start, plan, assign task, assess readiness and close.
- Unresolved: material-remobilisation threshold.

### Brand Service

- Purpose: govern Brand Variations and verification against applicable Brand Standards.
- Owns: Brand Variation and Brand Assurance Record.
- Does not own: Marketing approval authority, media storage, UI rendering or a complete Brand Standard model not yet governed.
- Depends on: AUTHMOD, Configuration and governed scope references.
- Evidence: BRAND-001, Pack 8 resolution and schemas.
- Candidate interactions: propose variation, record assurance and resolve effective variation.

### Waste Service

- Purpose: govern Waste Events, measurements, reasons and immediate operational outcomes.
- Owns: Waste Event and Waste Disposition.
- Does not own: Improvement Action or reporting authority.
- Depends on: OPLOC, Assignment and Measurement Catalogue reference.
- Evidence: WASTE-001, Pack 8 resolution and schemas.
- Candidate interactions: record event, record disposition, retrieve and aggregate.
- Unresolved: Measurement Catalogue values and detailed Improvement Action domain.

## Candidate boundaries not yet adopted

Equipment has partial governed evidence through SVC-009 and Equipment Allocation, but its full records, lifecycle and ownership are not yet governed. Media, Workforce, Logistics, Reporting, Documents, Notifications and Training remain candidates or future domains. Quote and Calendar currently describe workflows or provider interactions, not proven domain-service ownership.

No implementation may present these candidates as adopted Canon without the required business decision.

## Cross-domain rule

One logical domain service may reference another domain's stable identity or consume an attributable version/snapshot. It must not edit the other domain's record, duplicate its lifecycle or infer its authority.
