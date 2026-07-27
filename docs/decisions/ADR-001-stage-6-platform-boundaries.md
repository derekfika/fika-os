# ADR-001: Stage 6 Platform Boundaries

- Status: Accepted
- Date: 2026-07-25
- Stage: Stage 6 — Platform Architecture
- Decision owners: Platform Governance, constrained by approved business authority
- Supersedes: none
- Related records: ADR-003 and ADR-004 remain supporting decisions within this boundary

## Context

Stage 5 established governed business meaning across Packs 1–8. Earlier target-architecture and FIKA Core documents were deliberately provisional and sometimes placed domain schemas, workflows, configuration, branding, permissions and notifications inside a broad concept called FIKA Core. That framing no longer preserves the boundaries established by the Canon.

Stage 6 therefore needs an implementation-independent responsibility model before any platform build begins. It must identify where canonical records and business invariants live, how applications coordinate work, how storage and providers are hidden, and how current operational systems can coexist with the target without becoming permanent owners by accident.

This ADR establishes logical boundaries. It does not choose deployment topology, storage technology, transport, provider, programming language or hosting platform.

## Evidence and authority

| Evidence | Architectural conclusion | Authority class |
|---|---|---|
| CLIENT-001; LOC-001–006; TYPE-001–003; Pack 1 schemas | Client and Operational Location have separate stable identities and histories. Operational Location is a narrow anchor, not a container for operational records. | Business authority and governed schema evidence |
| ROLE-001–007; CFG-001–003; CAP-001–004; Pack 2 schemas | Ownership, assignment, authority, permission action, capability, configuration and technical administration are separate concepts. AUTHMOD grants scoped actions to roles. | Business authority and governed schema evidence |
| SVC-001–010; Pack 3 schemas | Service, Service Arrangement, Recurring Schedule, Event and Booking are distinct. Production and Training are domains, not Services. | Business authority and governed schema evidence |
| BOOK-001–007; Pack 4 schemas; ADR-003 | Booking owns commercial and service intent, source references, price snapshots and governed amendments. Legacy ingestion may adapt into the same domain. | Business authority and supporting architecture |
| EVT-001–002; Pack 5 Human Decision Resolution; Event schema | Event is distinct from recurring service and hospitality booking. It requires an Event Contact and auditable approval; Client is optional. | Business authority and governed schema evidence |
| PROD-001–005; Pack 6 Human Decision Resolution; production schemas; ADR-004 | Production owns fulfilment work, preparation rules, routing and production lifecycle. Only eligible Bookings create Production Orders. | Business authority and accepted architecture |
| MOB-001–004; Pack 7 Human Decision Resolution; mobilisation schemas | Mobilisation is a governed programme with explicit accountable role, optional Client relationship and preserved history. | Business authority and governed schema evidence |
| BRAND-001; WASTE-001; Pack 8 Human Decision Resolution; Pack 8 schemas | Brand Variation and Waste are separate domains. Brand assurance is not approval; Waste Disposition is not Improvement Action. | Business authority and governed schema evidence |
| Platform principles | Storage independence, configuration over duplication, gradual migration, source-of-truth clarity and replaceable applications are required. | Approved platform principle |
| Current-system inventories and audits | Current dashboards, Sheets, Calendar, Drive, inbox scanners and provider integrations include projections, adapters and operational systems; they do not establish canonical business ownership. | Operational evidence only |
| Draft or deferred concepts in Pack reports | Service Family, Service Template, final shared fulfilment-record name, Event lifecycle/publication policy, Measurement Catalogue values, material remobilisation threshold and Improvement Action detail remain unresolved. | Explicitly not decided |

## Decision

FIKA OS will use a layered, domain-centred architecture:

```text
Applications and operational experiences
                ↓
Application orchestration and process managers
                ↓
Logical domain services and their canonical records
                ↓
Narrow FIKA Core contracts
                ↓
Repository, projection and provider ports
                ↓
Storage, external providers and legacy adapters
```

The arrows express permitted dependency direction, not deployment layout. A logical domain service may be deployed with other services. No microservice decision is made.

### Business domains and logical domain services

A domain owns business meaning, canonical records, invariants and lifecycle decisions. A logical domain service is the controlled boundary through which applications and orchestrators request domain behaviour. Applications must not mutate domain records around that boundary.

| Logical domain service | Purpose and canonical ownership | Illustrative commands | Illustrative queries | Dependencies | Explicit exclusions | Evidence and unresolved points |
|---|---|---|---|---|---|---|
| Client | Maintain external-organisation identity, contacts and time-varying relationships to Operational Locations. | Establish Client; maintain Contact; record relationship | Get Client; list Contacts; find active location relationships | Authority context; Operational Location references | Location identity, bookings, services, access policy | CLIENT-001; LOC-005–006; Pack 1. Commercial lifecycle detail remains unresolved. |
| Operational Location | Maintain the durable identity, aliases, lifecycle and Location Type history of one operating place. | Establish; rename; change type; transition lifecycle | Resolve identity; get history; list current classifications | Authority context; Client relationship references | Address master data, applications, brand, equipment, staffing, bookings, services | LOC-001–006; TYPE-001–003; Pack 1. Exact lifecycle vocabulary beyond governed evidence remains unchanged. |
| Authority and Assignment | Maintain organisational roles, responsibilities, assignments, scoped authority grants, access boundaries and emergency access. | Assign role; grant/revoke action; approve/publish; activate emergency access | Evaluate effective grant; list responsibilities; reconstruct authority history | Client and Operational Location references where used as scope | Business-domain ownership, capability availability, authentication provider, technical administration | ROLE-001–007; Pack 2. Authentication implementation is not decided. |
| Operational Capability | Maintain the capability catalogue, dependency rules, enablements and authorised overrides. | Register governed capability; enable/disable; authorise override | Resolve effective capability state; validate combination | Owning domains; Configuration; Authority | Domain meaning, role assignment, permissions, application features | CAP-001–004; Pack 2. Domain owners define capability meaning. |
| Configuration | Resolve explicitly governed configuration values across permitted scope relationships. | Define value; authorise variation; expire override | Resolve effective value; explain inheritance path | Owning domain; Authority; capability rules | Business meaning, secrets, permission grants, universal precedence | CFG-001–003; Pack 2. No universal scope precedence is assumed. |
| Service | Maintain Services, OPLOC-specific Service Arrangements, Recurring Schedules, exceptions and commercial ownership references. | Define Service; establish Arrangement; revise schedule; record exception | Get offering; resolve arrangement; list effective schedule | Operational Location; Authority; Capability; Event references | Booking, Event, Production or Training lifecycle | SVC-001–010; Pack 3. Service Family, Service Template and final shared work-input name remain deferred. |
| Booking | Maintain commercial and service intent, booking items, service timing, source references, accepted price snapshots and amendment/cancellation/decline history. | Submit; acknowledge; amend; cancel; decline; confirm | Get current version; get history; retrieve fulfilment intent | Service Arrangement where applicable; Client/Contact and OPLOC references; Authority | Dashboard workflow, parser internals, production state, provider payloads | BOOK-001–007; ADR-003; Pack 4. The existing draft FikaBooking aggregate requires later reconciliation with Pack 4 schemas. |
| Event | Maintain bespoke Event purpose, qualification, Event Contact, optional Client reference, Service references and auditable approval. | Propose; qualify; approve; amend | Get Event; list by OPLOC; retrieve approval history | Operational Location; Service; Client optionally; Authority | Recurring service, hospitality booking, publication policy, provider/calendar record | EVT-001–002; Pack 5. Lifecycle and publication policy remain deferred. |
| Production | Maintain Production Orders, Production Lines, routing allocations, preparation quantities/rules and production change history. | Create from eligible Booking; plan; start; complete; route; handle change | Get order; list work by OPLOC/readiness; reconstruct changes | Booking snapshot/reference; Operational Location; Capability; Authority | Customer-facing booking state, separate facility concept, logistics state | PROD-001–005; ADR-004; Pack 6. Additional lifecycle states are deferred. |
| Mobilisation | Maintain each governed programme of establishment or material change, its scope, accountable role, tasks, phase plan and readiness evidence. | Start; plan; assign task; assess readiness; close | Get programme; list tasks/risks; retrieve history | Operational Location and/or other governed scope; Authority; Capability; optional Client | Routine change, fixed MNK phase Canon, mandatory Client/contract basis | MOB-001–004; Pack 7 resolution. Material-remobilisation threshold is deferred. |
| Brand | Maintain governed Brand Variations and Brand Assurance Records against applicable Brand Standards. | Propose variation; record assurance; authorise effective variation | Resolve applicable variation; get assurance history | Authority; Configuration; optional Client/OPLOC scope | Marketing approval workflow invention, media repository, UI rendering | BRAND-001; Pack 8 resolution and schemas. The complete Brand Standard domain remains to be governed. |
| Waste | Maintain Waste Events, measured quantities, reasons and immediate Waste Dispositions. | Record event; record disposition; correct through governed history | List by OPLOC/time/category; aggregate for reporting | Operational Location; Assignment; Measurement Catalogue reference | Improvement Action, reporting ownership, hardcoded measurement catalogue | WASTE-001; Pack 8 resolution and schemas. Measurement values and Improvement Action detail remain deferred. |

Equipment appears in governed Service evidence and an allocation schema, but Packs 1–8 do not yet establish a complete Equipment service boundary. Media, Workforce, Logistics, Reporting, Documents and Notifications remain candidate or future domains. They must not be presented as adopted bounded contexts until their business meaning is governed.

### FIKA Core

FIKA Core is a narrow, domain-neutral contract layer. It standardises only concerns that must mean the same thing across more than one domain:

- canonical identifier and reference conventions without owning domain identities;
- schema-version, record-version, effective-time, provenance and audit conventions already repeated across governed Packs;
- actor, assignment and authority-context references without owning AUTHMOD policy;
- correlation, causation, idempotency and optimistic-concurrency context where a workflow requires them;
- common validation-issue and operation-result shapes without owning domain rules;
- domain-event envelope conventions without owning event meaning;
- repository, projection and provider-port conventions.

FIKA Core does **not** own:

- domain schemas or canonical records;
- business rules, lifecycles or approval thresholds;
- domain services;
- end-to-end business workflows;
- roles, permission grants, configuration values, brands or notification policy;
- document, quote or calendar business meaning;
- application screens, dashboards or provider integrations;
- general-purpose utilities merely because several applications use them.

A capability enters Core only when it is demonstrably domain-neutral, reused across multiple governed domains, stable in meaning and free of provider or application concerns. Otherwise it remains in its owning domain, orchestration layer or adapter.

### Application orchestration

Application orchestration coordinates a use case spanning domain services. It may:

- authenticate the initiating actor and supply authority context;
- invoke domain commands in an explicit order;
- carry correlation and idempotency context;
- respond to a committed domain event;
- invoke projection, notification or provider ports;
- compensate or surface partial failure according to an approved policy.

It must not redefine invariants, manufacture authority, mutate another domain's record directly, or treat a provider response as canonical business meaning.

Booking-to-Production is the first confirmed cross-domain example. Booking decides and records the commercial/service change. Production independently decides whether the Booking requires operational fulfilment and creates or updates its own record from an attributable Booking version. The exact delivery guarantee and compensation policy require a later ADR.

### Repositories, projections and adapters

Each canonical aggregate has one logical repository contract owned with its domain. The contract expresses business retrieval and persistence needs without exposing tables, documents, files, Sheets or provider objects.

Read projections are separately named, disposable views optimised for a consumer. Dashboards and reports may read projections but must not become the only place where canonical state or business history exists. A projection may be rebuilt from canonical records and durable audit/integration evidence.

Adapters translate between a port and storage, a provider, a legacy input or a legacy operational system. Adapters may validate transport and provider constraints, but they do not own business rules. Provider identifiers and payloads remain integration metadata outside canonical aggregates except for stable references explicitly required by a governed domain.

### Domain events, notifications and audit

- A domain event records a business fact only after the owning domain has accepted and persisted the corresponding change.
- Event names and payloads use canonical domain language and contain only the minimum information consumers need to identify and retrieve the authoritative record.
- Consumers must tolerate repeated delivery; idempotency is required at effect-producing boundaries.
- Notifications are consequences of business facts. Generation policy belongs to the applicable domain or orchestration policy; channel delivery belongs to an adapter.
- Audit records who or what acted, under which assignment or authority where applicable, what changed, when, why and the source/correlation context required for reconstruction.
- Audit evidence is not a substitute for a canonical record, and logs are not a substitute for governed audit history.

The event envelope, taxonomy, delivery assumptions, idempotency, ordering and replay boundaries are governed by [ADR-005](ADR-005-domain-event-and-integration-contract.md). Repository ownership, canonical persistence, concurrency, cross-domain consistency, partial failure and publication recovery are governed by [ADR-006](ADR-006-repository-and-consistency-contract.md). Retention policy remains deferred.

### Enforcement boundaries

Enforcement is layered:

1. Schemas reject structurally invalid records at every trust boundary.
2. Domain services enforce business invariants and lifecycle rules.
3. AUTHMOD evaluation enforces the actor's scoped action independently of ownership, assignment and capability state.
4. Orchestration enforces cross-domain sequencing and approved preconditions.
5. Adapters enforce provider and transport constraints without changing business meaning.
6. Repositories enforce persistence concurrency and durable uniqueness required by the domain contract.

Applications may provide early feedback, but user-interface validation is not authoritative enforcement.

### Current systems and legacy coexistence

Every current system must be recorded using one or more explicit classifications:

- **Canonical authority** — the accepted owner of a canonical business record.
- **Operational system of execution** — performs operational work using canonical records or governed projections.
- **Read projection** — rebuildable consumer view with no independent business authority.
- **Provider** — external delivery or infrastructure capability behind an adapter.
- **Legacy transition partner** — temporarily supplies or receives data while migration is controlled.
- **Planned retirement candidate** — may be retired only after equivalent capability, reconciliation and rollback evidence exist.

Unknown classifications remain `TODO`; familiarity or current production use does not imply canonical ownership. Existing applications may coexist during migration, but each coexistence path must name the authoritative record, direction of synchronisation, conflict handling, reconciliation evidence and exit condition. No retirement date is decided here.

## Consequences

### Positive

- Canonical business meaning stays with the domain that owns it.
- Applications and providers become replaceable without redefining records.
- FIKA Core is small enough to remain stable and reusable.
- Booking, Event, Service and Production cannot collapse into one ambiguous workflow model.
- Current dashboards and Sheets can continue as operational projections while canonical ownership is introduced gradually.
- New storage or hosting choices remain reversible.

### Costs and constraints

- Cross-domain workflows need explicit orchestration and failure policy.
- Some current systems will need adapters and reconciliation rather than direct replacement.
- Repository ports and projection boundaries add discipline before implementation.
- Several candidate domains cannot receive final service boundaries until business discovery is complete.

## Trade-offs

This decision favours clear ownership and replaceability over immediate implementation simplicity. It accepts temporary duplication in controlled projections and legacy adapters, but rejects duplicated business authority. It favours logical service boundaries without forcing independently deployed services.

## Rejected alternatives

### Broad FIKA Core owning shared business capabilities

Rejected because configuration, authority, branding, notification policy and workflows have domain-specific ownership. Centralising them in Core would obscure business authority.

### Applications owning their own business models

Rejected because site variants and dashboards would continue to redefine canonical meaning and create inconsistent histories.

### Providers or storage models defining contracts

Rejected by storage independence and adapter boundaries.

### One end-to-end operational aggregate

Rejected because Booking, Event, Service, Production and later Logistics have different meaning, ownership and lifecycle.

### Microservices as the default topology

Rejected as a premature implementation choice. The services in this ADR are logical boundaries.

### Immediate replacement of legacy systems

Rejected because gradual migration requires continuity, reconciliation and operational safety.

## Migration implications

1. Classify each current system and data store before changing it.
2. Establish repository and adapter ports around existing authoritative behaviour.
3. Normalise legacy inputs at an ingestion boundary while preserving stable provenance.
4. Build projections from canonical records where a governed canonical source exists.
5. Introduce cross-domain orchestration incrementally, beginning with Booking-to-Production evidence.
6. Compare new outputs with current operational outputs before switching responsibility.
7. Retire a legacy path only after the owning business role accepts the replacement capability and technical validation proves reconciliation and rollback readiness.

This ADR authorises no production migration.

## Observability implications

Future implementations must make it possible to trace a business change across application, orchestration, domain service, repository and adapter boundaries using stable record, correlation and causation references. Operational measures must distinguish command rejection, concurrency conflict, provider failure, projection lag, retry and permanent failure. Business reports remain projections and must not be used as the sole audit trail.

## Security implications

- Authority is evaluated from explicit, effective AUTHMOD grants, never inferred from job title, application access, capability enablement or technical administration.
- Least privilege and governed scope apply at domain-service and repository boundaries, not only in the user interface.
- Sensitive fields may require restricted views or projections defined by their owning domain.
- Emergency access remains time-limited, auditable and independently reviewed.
- Secrets and provider credentials remain outside canonical records and configuration inheritance.

## Unresolved questions

- Physical delivery implementation and domain-specific retention policy after ADR-005 and ADR-006.
- Domain-specific merge, compensation and conflict policies where business authority is not yet governed.
- Authentication identity mapping into Person, Assignment and AUTHMOD references.
- Projection ownership, refresh objectives and reconciliation for each application.
- Complete domain boundaries for Equipment, Media, Workforce, Logistics, Reporting, Documents and Notifications.
- Whether Quote and Document become domains, domain-owned components or orchestration capabilities.
- Which current systems qualify as canonical authorities beyond the confirmed Booking Platform direction.
- Legacy retirement thresholds and accountable acceptance roles per migration.

## Questions returned to business discovery or BDR creation

Architecture must not resolve the following:

- Event lifecycle and publication authority.
- Service Family, Service Template and the final shared fulfilment-record name.
- Measurement Catalogue values and governance detail beyond its Operations ownership.
- Improvement Action purpose, ownership, lifecycle and relationship to Waste.
- Material-remobilisation threshold.
- Business meaning and ownership for undeveloped candidate domains.
- Approval thresholds, escalation rules and notification policy not already governed.
- Legacy-system retirement acceptance where operational ownership is not established.

## Required follow-up ADR register

| ADR | Scope | Trigger | Status |
|---|---|---|---|
| [ADR-005 Domain event and integration contract](ADR-005-domain-event-and-integration-contract.md) | Envelope, idempotency, ordering, delivery and replay | Before implementing cross-domain event delivery | Accepted 2026-07-25 |
| [ADR-006 Repository and consistency contract](ADR-006-repository-and-consistency-contract.md) | Aggregate persistence, concurrency, transactions and failure semantics | Before selecting or building repository implementations | Accepted 2026-07-27 |
| [ADR-007 Projection and dashboard boundary](ADR-007-projection-and-dashboard-boundary.md) | Projection ownership, rebuild, freshness and write-back prohibition; Hospitality dashboard is the first case study | Before replacing or materially changing operational dashboards | Accepted 2026-07-27 |
| ADR-008 Identity and AUTHMOD enforcement boundary | Authentication mapping, actor context and enforcement responsibilities | Before platform identity implementation | Next bounded task |
| ADR-009 Booking-to-Production orchestration | Trigger, Booking-version contract, retries, compensation and reconciliation | Before implementing canonical Production creation | Planned |
| ADR-010 Legacy coexistence and retirement | Classification evidence, cutover, reconciliation, rollback and acceptance | Before retiring any current operational path | Planned |
| ADR-011 Notification generation and delivery | Domain intent, recipient policy, delivery adapters and audit | Before a shared notification capability is implemented | Planned |

The numbers are reserved as a planning register only. Each ADR requires its own evidence and review.

## Validation notes

This ADR was checked against Packs 1–8 Decisions, Pack Human Decision Resolutions, schema catalogues, traceability reports, current-system inventories, platform principles and the Stage 6 brief. It changes no BDR, schema, fixture or production repository.
