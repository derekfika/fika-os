# ADR-006: Repository and Consistency Contract

- Status: Accepted
- Date: 2026-07-27
- Stage: Stage 6 — Platform Architecture
- Decision owners: Platform Governance, constrained by each owning domain's approved business authority
- Depends on: ADR-001 and ADR-005
- Related records: ADR-003 and ADR-004 remain supporting decisions within this boundary
- Supersedes: none

## Context

[ADR-001](ADR-001-stage-6-platform-boundaries.md) established logical domain ownership, narrow FIKA Core contracts, application orchestration, repositories, projections and adapters. [ADR-005](ADR-005-domain-event-and-integration-contract.md) established the contract for completed domain facts and their publication. Neither decision completed the contract for retrieving and changing canonical state, detecting competing changes, coordinating multi-domain work or recovering when persistence, publication, provider execution or projection processing only partly succeeds.

Current operational systems use Sheets, Calendar, Drive, Gmail, dashboards and provider interfaces in several roles. Their operational importance does not by itself make them canonical repositories. The architecture needs consistent rules that preserve business ownership and invariants while allowing those systems to coexist during gradual migration.

This ADR defines logical contracts. It does not imply separately deployed services or databases and does not select persistence, messaging or transaction technology.

## Evidence considered

| Evidence | Supported conclusion | Authority |
|---|---|---|
| [ADR-001](ADR-001-stage-6-platform-boundaries.md) | Domains own canonical meaning and invariants; repositories, projections, providers and orchestration are separate logical responsibilities. | Accepted architecture |
| [ADR-005](ADR-005-domain-event-and-integration-contract.md) | A domain event follows a valid durable change; delivery is at least once; consumers and side effects require separate idempotency; publication and processing are distinct. | Accepted architecture |
| [Platform principles](../platform-principles.md) | Storage independence, source-of-truth clarity, explicit failure, observable automation, replaceable providers and gradual migration are required. | Canonical principles |
| [ROLE-002](../business-decisions/role-002-roles-responsibilities-assignments.md), [ROLE-003](../business-decisions/role-003-permission-actions.md), [ROLE-005](../business-decisions/role-005-approval-publication-separation.md), [ROLE-006](../business-decisions/role-006-access-boundaries.md) and [ROLE-007](../business-decisions/role-007-emergency-access.md) | Responsibility, assignment, authority, approval, publication and technical access are distinct; access never creates business authority. | Canonical Decision sections |
| [CFG-001–003](../business-decisions/cfg-001-configuration-ownership.md) and [CAP-001–004](../business-decisions/cap-001-operational-capability-definition.md) | Configuration and capability are governed independently of permission and business ownership and must be evaluated in their applicable scope. | Canonical Decision sections |
| [SVC-005](../business-decisions/svc-005-recurring-schedule-governance.md), [BOOK-004](../business-decisions/book-004-immutable-pricing-amendments.md), [BOOK-006](../business-decisions/book-006-booking-amendment-cancellation-decline.md), [PROD-004](../business-decisions/prod-004-production-amendments-cancellations.md), [TYPE-003](../business-decisions/type-003-location-type-history.md) and [MOB-001](../business-decisions/mob-001-mobilisation-journey.md) | Governed history, effective-dated change, attributable versions and non-destructive amendments recur across domains. | Canonical Decision sections |
| [BOOK-007](../business-decisions/book-007-booking-source-references.md) and [provider-mapping principles](../platform-methodology/provider-mapping-principles.md) | Stable provenance must survive ingestion; provider and parser models remain outside canonical meaning. | Canonical Decision and method |
| [Pack 1 traceability](../schema-reviews/pack-1-bdr-to-schema-traceability.md), [Pack 2 traceability](../schema-reviews/pack-2-bdr-to-schema-traceability.md), [Pack 3 traceability](../schema-reviews/pack-3-bdr-to-schema-traceability.md), [Pack 4 traceability](../schema-reviews/pack-4-bdr-to-schema-traceability.md), [Pack 5 traceability](../schema-reviews/pack-5-bdr-to-schema-traceability.md), [Pack 6 traceability](../schema-reviews/pack-6-bdr-to-schema-traceability.md), [Pack 7 traceability](../schema-reviews/pack-7-bdr-to-schema-traceability.md) and [Pack 8 traceability](../schema-reviews/pack-8-bdr-to-schema-traceability.md) | Stable identifiers, references, provenance, effective time, audit and record versions are recurring governed contract evidence; schemas do not prescribe repositories. | Integrated schema evidence |
| [Current-system map](../current-system-map.md) | Dashboards, Sheets, Calendar records, documents and provider systems have mixed execution, projection, adapter and reporting roles; those roles do not establish canonical ownership. | Canonical current-state evidence |
| [Stage 5 closure](../stages/stage-5-closure-2026-07-25.md) and [Stage 6 record](../stages/stage-6-platform-architecture.md) | Packs 1–8 are the protected baseline and repository consistency is the next registered architecture decision. | Canonical stage records |

## Decision

FIKA OS will preserve canonical state through **domain-owned logical repository contracts** whose boundaries follow governed responsibility and invariants. Domain services are the authoritative command boundary. Repositories persist accepted state; they do not decide business meaning, grant authority or provide a shortcut around domain validation.

Cross-domain work is coordinated as an observable workflow of independently accepted domain changes. It does not assume one distributed transaction. Canonical persistence, integration publication, provider execution, projections and workflow progress remain distinguishable outcomes and are reconciled explicitly when they diverge.

### Repository taxonomy

| Term | Meaning | Explicit boundary |
|---|---|---|
| Domain repository | Interface through which an owning logical domain retrieves and persists canonical state needed to enforce governed invariants. | Repository is not a database, provider API, projection, ORM abstraction or general query service. |
| Write-model repository | Domain repository used during commands, lifecycle transitions and invariant enforcement. | It is not a reporting or cross-domain join interface. |
| Domain query | Authorised read operation exposed by the owning domain for authoritative current information. | It does not grant mutation authority or expose persistence layout. |
| Read projection | Derived, consumer-oriented view for operations, dashboards or cross-domain visibility. | It may lag and be denormalised; it is not authoritative over source domains. |
| Reporting dataset | Derived analytical or historical representation for trends, aggregates and exports. | It does not own source business facts. |
| Provider gateway | Outbound adapter interface expressing a required external capability. | Provider storage and provider objects are not canonical repositories. |
| Legacy gateway or migration repository | Bounded adapter for importing, reading, reconciling or temporarily writing a legacy system. | Authority, execution direction and transition status must remain explicit. |
| Consistency scope | Logical boundary within which all changes required to preserve a governed invariant succeed together or the canonical change is rejected. | This term selects no aggregate pattern, transaction manager or storage feature. |
| Workflow or process-state repository | Persistence for orchestration progress, retries, waiting, intervention, compensation and reconciliation. | It owns process facts, not participating domains' canonical records. |
| Integration checkpoint | Processing metadata for publication, delivery, deduplication, quarantine, replay or provider reconciliation. | It is neither canonical domain state nor the ADR-005 event envelope. |

Canonical record is not the same thing as a persistence entity. Persistence version is not canonical schema version. A logical repository may span several physical structures, and one physical implementation may host several logical repositories without merging their ownership.

## Repository ownership and placement

- A repository contract belongs with the logical boundary that owns the canonical record and invariants it protects.
- The domain service validates and accepts commands; persistence implementations sit behind its repository contract.
- Other domains and applications must not directly mutate that repository. They use authorised commands, domain queries or governed integration contracts.
- Application orchestration may sequence calls and retain process state but cannot bypass a participating domain's rules.
- Repository boundaries follow business consistency requirements, not one repository per schema, table, collection, dashboard or screen.
- One domain may have several repositories where separate consistency boundaries justify them. Several records may share one repository when governed evidence requires them to remain valid together.
- A repository may return the canonical state needed for a command, its attributable history, and a comparison token. It must not grow into an unrestricted data-access layer.
- FIKA Core may standardise narrow identifiers, references, comparison context and outcome semantics. It must not become a universal repository collection, shared persistence model, generic data-access layer, provider layer or store for every schema.
- Logical separation does not require separate databases, processes or deployments.

### Evidence-supported repository families

These are logical ownership families, not prescribed interfaces or a repository-per-schema catalogue.

| Family | Owning domain | Canonical scope and protected invariants | Command/query use | Explicit exclusions | Evidence and unresolved points |
|---|---|---|---|---|---|
| Client and relationship state | Client | Client identity, Client Contacts and effective OPLOC relationships retain distinct identity and history. | Establish and maintain through Client commands; query current identity, contacts and effective relationships. | OPLOC internals, Booking and provider/customer objects. | CLIENT-001; LOC-005–006; Pack 1. Exact consistency grouping is an implementation/domain-design choice unless a future invariant requires more. |
| Operational Location state | Operational Location | Durable OPLOC identity, aliases, lifecycle and Location Type history remain attributable and valid. | Establish, rename, classify and transition; resolve identity and history. | Application, address-provider, Service, Booking and equipment records. | LOC-001–006; TYPE-001–003; Pack 1. |
| Authority and assignment state | Authority and Assignment | Explicit effective roles, responsibilities, assignments, grants and access boundaries preserve separation and auditability. | Governed assignment/grant commands; authoritative effective-authority evaluation. | Authentication-provider objects, inferred authority and business-domain records. | ROLE-001–007; Pack 2. Identity mapping is ADR-008. |
| Capability state | Operational Capability | Catalogue ownership, dependencies, enablement and authorised overrides remain coherent. | Governed catalogue/enablement commands; effective capability evaluation. | Domain rules, permissions and application features. | CAP-001–004; Pack 2. |
| Configuration state | Configuration | Effective values and variations preserve domain ownership, scope, history and authorised inheritance. | Define/publish/expire configuration; resolve effective value and provenance. | Secrets, permission grants and ungoverned universal precedence. | CFG-001–003; Pack 2. |
| Service state | Service | Service, OPLOC-specific Arrangement, schedules and exceptions preserve effective history and their governed distinctions. | Define and revise Service/Arrangement/schedule; query effective offering and schedule. | Booking, Event and Production state. | SVC-001–010; Pack 3. Final shared work-input name remains deferred. |
| Booking state | Booking | Commercial/service intent, items, source references, price snapshots and governed amendment/cancellation/decline history remain attributable. | Booking lifecycle commands; query current version, history and fulfilment intent. | Parser internals, dashboard workflow, Production state and provider payloads. | BOOK-001–007; Pack 4; ADR-003. Aggregate reconciliation remains future design. |
| Event state | Event | Event meaning, Event Contact, optional Client link and auditable approval remain coherent. | Propose/qualify/approve/amend; query current Event and approval history. | Calendar record, provider publication state and recurring Service. | EVT-001–002; Pack 5. Lifecycle/publication policy remains deferred. |
| Production state | Production | Orders, Lines, routing, timing and change history preserve Production-owned fulfilment invariants. | Create/plan/start/complete/route under Production rules; query work and attributable changes. | Booking commercial state, provider execution and Logistics state. | PROD-001–005; Pack 6; ADR-004. Detailed Booking-to-Production workflow is ADR-009. |
| Mobilisation state | Mobilisation | Each governed programme retains its scope, accountable role, plan, tasks, readiness and history. | Start/plan/assess/close; query programme progress and evidence. | Routine operational tasks and participating domains' records. | MOB-001–004; Pack 7. Material-remobilisation threshold remains deferred. |
| Brand state | Brand | A Brand Variation retains authority and at least one separate assurance record. | Propose/authorise variation and record assurance; query effective variation. | Media binaries, rendering and invented approval workflow. | BRAND-001; Pack 8. Full Brand Standard boundary remains future work. |
| Waste state | Waste | Waste Event quantity/reason and immediate Waste Disposition remain distinct and attributable. | Record/correct through governed history; query events and dispositions. | Improvement Action and reporting datasets. | WASTE-001; Pack 8. Measurement Catalogue values remain deferred. |

Equipment, Media, Workforce, Logistics, Reporting, Documents, Notifications and Quote do not gain canonical repositories through this ADR. Their eventual ownership requires governed evidence. Projection, audit and integration-checkpoint persistence may exist without creating new business domains.

## Canonical write-model boundary

For an attempted canonical change:

1. The domain service receives the command with actor, authority, correlation and idempotency context where applicable.
2. Applicable capability, configuration, permission, authority and domain invariants are evaluated at their owning boundaries.
3. The write-model repository retrieves the canonical state and comparison context needed to decide safely.
4. All changes needed to preserve the governed invariant enter one logical consistency scope.
5. The repository persists the accepted change with required provenance, history and a resulting version or comparison token.
6. Only durable success may be reported as an accepted canonical change or produce an authoritative domain event.

A persistence failure or uncertain outcome must not be converted into business success. Repository access itself never grants permission or authority.

## Domain-query boundary

An authoritative domain query may return:

- current canonical state where the caller is authorised to receive it;
- a deliberately constrained domain view;
- a domain-owned eligibility or validation result;
- current lifecycle or effective status;
- a version, revision or comparison token required for a safe later command.

Queries are owned and secured by the source domain. A query result is not permission to mutate, and a cached result is not automatically current enough for a later decision. Cross-domain reporting and broad search belong in projections rather than write repositories.

## Aggregate and invariant principles

This ADR uses **consistency scope** as the required architectural term. An implementation may use an aggregate pattern, but no aggregate-root catalogue is adopted.

- Transaction boundaries follow governed invariants, not storage convenience.
- Records that must change together to remain valid belong in one logical consistency scope.
- Appearing in one workflow, document, dashboard or schema Pack does not establish atomicity.
- Cross-domain references normally use stable canonical identifiers and attributable versions rather than embedded copies of another domain's full state.
- A domain may validate a reference through an authoritative query or an accepted fact without taking ownership of the referenced record.
- Denormalised projection data never changes canonical ownership.
- Any unrecorded business invariant needed to choose a wider scope returns to the BDR process.

## Transaction boundaries

### Within one consistency scope

- Relevant domain rules and authority must pass before acceptance.
- All state, history and provenance required to preserve the governed invariant succeed as one logical outcome or the change is rejected.
- Failed persistence is not successful business completion.
- Required audit evidence must not be silently omitted.
- The resulting comparison token is made available when concurrent change is possible.
- Recording or recovering the associated authoritative event must satisfy the publication-consistency rules below.

This does not prescribe a technical transaction, isolation level or locking mechanism.

### Across domain boundaries

- No distributed transaction is assumed.
- Every domain retains its own invariants and acceptance decision.
- Orchestration coordinates commands and observes authoritative facts.
- A multi-domain workflow may be eventually consistent and must expose intermediate and partial states.
- A completed upstream fact remains valid when a later domain refuses or fails unless governed business policy defines a compensating action.
- Compensation is a new authorised business action, not an invented technical rollback.
- Workflow state must not overwrite participating-domain lifecycle state.

Where material, implementations distinguish: requested, accepted, persisted, published, delivered, processed, externally executed and reconciled. These are not one universal lifecycle; they are separate outcome dimensions used only when relevant.

## Concurrency and conflict handling

- Canonical writes must be protected from unnoticed stale changes where concurrent updates are possible.
- Optimistic concurrency is the default architectural expectation: a command supplies or derives an expected canonical version, revision or equivalent comparison token. This does not mandate an implementation technique.
- Timestamps alone are not presumed sufficient comparison tokens.
- A mismatch is an explicit conflict, never silent last-write-wins.
- Retrying a stale command requires current state to be read and the command, authority, capability, configuration and invariants to be revalidated.
- The original initiating context remains attributable, but authority may require fresh evaluation if relevant state or effective time changed.
- Automatic merging is prohibited where it could change business meaning. Domain-specific merge rules require governed authority.
- Occurrence order, receipt order and wall-clock recency do not automatically establish business precedence.
- Late events or provider callbacks cannot overwrite newer canonical state without an approved rule.
- Exceptional human resolution must be visible and auditable.

The architecture distinguishes duplicate command, stale command, competing valid commands, validation rejection, authority rejection, provider conflict, persistence failure and projection lag.

## Command idempotency

- Event deduplication recognises repeated delivery of one `eventId`; command idempotency recognises repeated submission of one logical request. They are separate controls.
- Commands that may be retried, submitted asynchronously or cause costly/irreversible effects carry a stable request or idempotency identifier within an identified command scope.
- The handler records enough intent fingerprint and outcome reference to distinguish the same request, uncertain retry and a genuinely new request without retaining unnecessary sensitive payload copies.
- A recognised duplicate with equivalent intent may return the already accepted canonical outcome.
- Reuse of the same identifier with materially different intent is rejected or quarantined; it cannot silently become a new command.
- Duplicate recognition does not bypass current security or invariant evaluation where changed state makes reuse unsafe. Any exception requires explicit domain policy.
- External provider writes, notifications and other side effects have independent idempotency and reconciliation because canonical command receipt does not prove their execution.
- Idempotency retention and privacy follow later policy; no universal duration is adopted.

## State-change and event-publication consistency

An authoritative domain event corresponds to a valid completed fact. Emitting a message alone never proves a canonical change.

- The architecture must prevent or detect an event published without a valid durable fact.
- A durable canonical change whose required integration publication is incomplete remains a valid domain fact with observable publication work outstanding.
- Publication uncertainty, acknowledgement uncertainty and permanent publication failure are recorded and reconcilable.
- Duplicate publication reuses the same immutable `eventId`; recovery does not invent a second business occurrence.
- Consumers continue to deduplicate and revalidate commands under ADR-005.
- Integration publication status is technical processing state, not canonical business outcome.
- Recovery must be able to identify a canonical fact whose intended publication is absent and complete or escalate that publication without editing the fact.
- Consumers may receive an event before a projection catches up and must not assume projection freshness.
- Replay after a defect follows ADR-005 and does not repeat external effects without separate authorisation and idempotency.

Transactional outbox, durable event recording, change-data capture and other approaches remain implementation choices. Event sourcing remains unselected.

## Application-orchestration persistence

An orchestrator may persist:

- workflow and correlation identifiers;
- current process step and waiting condition;
- requested, accepted and completed domain-operation references;
- canonical record identifiers and versions;
- retry position and uncertain-outcome state;
- timeout, escalation or exceptional-intervention state;
- authorised compensation and reconciliation status;
- user-facing workflow progress where separately labelled.

It stores process facts and references, not copies that acquire ownership of participating records. It cannot repair another domain through direct repository access. Restart and recovery use persisted process state plus authoritative domain queries. Refused business commands are not treated as technical retries. Compensation commands remain subject to receiving-domain validation and authority. User-facing workflow progress and technical processing status remain distinct.

## Partial failure, reconciliation and recovery

- Partial completion is explicit, attributable and observable.
- Recovery first determines whether an earlier outcome is absent, failed, completed or uncertain; blind repetition is prohibited.
- Reconciliation compares authoritative facts, workflow state, integration checkpoints, provider observations and projections without silently choosing a winner.
- A confirmed canonical fact is not erased merely to make a workflow appear atomic.
- Technical recovery may resume safe processing. Any business correction, compensation or conflict resolution requires the owning domain's governed command and authority.
- Unresolved divergence is surfaced for authorised intervention with correlation, affected records, versions, attempted actions and provider/legacy references.
- Reconciliation evidence records what was compared and resolved; it is not itself the canonical business record.

## Projection and reporting boundary

- Authoritative decisions use a domain query when current owned state is required.
- Projection builders consume authorised facts or queries and maintain separately named derived state.
- Read projections may combine domains, denormalise and lag. Reporting datasets may aggregate and reinterpret for analysis. Neither gains source-domain authority.
- Write-model repositories are not general dashboard or reporting data sources.
- Projection lag, processing failure, last completed source position and rebuild/reconciliation status must be observable where material.
- A stale projection cannot support an authoritative decision unless a governed policy explicitly permits that risk.
- Projection replay follows ADR-005 and must not repeat external side effects.
- Dashboard formatting, reporting calculations and projection-processing status stay outside canonical repositories.
- Direct dashboard/report access to physical write storage is not part of the governed architecture unless a later exceptional decision justifies it.
- Legacy and new dashboards may coexist during migration.

Detailed freshness, rebuild and Hospitality-dashboard design are reserved for ADR-007.

## Provider and legacy boundaries

- Provider APIs are reached through gateways or adapters, never treated as canonical repository contracts merely because providers retain data.
- An inbound provider observation is validated and mapped before an owning domain may accept a resulting command.
- Canonical identifiers/versions and provider identifiers/versions/concurrency tokens remain distinct.
- Provider write success proves only the provider outcome it explicitly acknowledges, not the complete FIKA business workflow.
- An uncertain provider outcome requires safe lookup, retry or reconciliation rather than blind repetition.
- Legacy spreadsheets and applications may remain systems of execution during controlled coexistence.
- A legacy gateway may import, synchronise, reconcile or temporarily write back while preserving source references and authority direction.
- Temporary write-back does not make the gateway or legacy store canonical.
- Canonical-versus-legacy conflict is never silently resolved. Cutover and retirement remain separately governed.

No real system receives a new authority classification through this ADR. The [current-system map](../current-system-map.md) remains authoritative for known classifications and TODOs.

## Audit, security and observability relationship

For governed changes and exceptional processing, the architecture must be able to attribute, as applicable:

- initiating actor and authority context;
- canonical record and prior/resulting version;
- attempted and accepted change time;
- correlation and causation;
- adapter, provider or legacy involvement;
- manual intervention and reason;
- conflict and reconciliation outcome;
- failed or uncertain persistence;
- incomplete publication;
- projection lag/failure and exceptional recovery.

Repository access is not authorisation. Commands pass applicable capability, configuration, permission, responsibility and authority checks. Technical administration does not create business authority, and persistence code is not an alternative permission boundary.

Audit evidence is generated from governed actions but is not replaced by an event stream. Logs, metrics and traces remain operational evidence and must not become uncontrolled copies of canonical or sensitive data. Technical health, business state and workflow state remain distinct. This ADR selects no audit, logging, tracing or monitoring product and does not decide whether audit uses one logical repository.

## Error and outcome semantics

| Outcome | Canonical change? | Retry/revalidation | Classification and required visibility |
|---|---|---|---|
| Accepted and persisted | Yes | No retry; return outcome/version. | Business success; publication may still be separately incomplete. |
| Recognised duplicate | No new change | Return prior outcome if safe; revalidate where state/authority matters. | Idempotency outcome; expose original outcome reference. |
| Validation rejected | No | Retry only after corrected intent; revalidate. | Business/structural rejection; expose safe reasons. |
| Capability unavailable or configuration disabled | No | Re-evaluate after governed state changes. | Business availability/configuration outcome; do not convert to technical failure. |
| Permission denied or authority insufficient | No | Requires valid authority, not blind retry. | Security/business-authority outcome; audit without unsafe disclosure. |
| Not found | No | Recheck identity/visibility before retry. | Domain/query outcome; distinguish hidden-for-security where required. |
| Version conflict or stale write | No for this attempt | Read current state and fully revalidate. | Concurrency conflict; never silent overwrite. |
| Consistency conflict | No accepted change for the affected scope | Domain-specific resolution or human review. | Business consistency outcome; preserve competing evidence. |
| Persistence unavailable | No confirmed change | Retry only under idempotency and safety rules. | Technical failure; observable. |
| Persistence outcome uncertain | Unknown | Lookup/reconcile before retry. | Technical uncertainty; never report success. |
| Publication incomplete | Canonical fact may be valid | Recover publication with same event identity. | Integration-processing state; reconcile visibly. |
| Provider outcome uncertain | Canonical state depends on the explicit workflow contract | Lookup/reconcile before external retry. | Provider/integration state; preserve provider references. |
| Projection unavailable or stale | Source canonical state unchanged | Rebuild/catch up; use domain query for authoritative decisions. | Projection state; expose freshness. |
| Workflow partially complete | Participating facts may be valid independently | Resume, reconcile or issue authorised compensation. | Workflow state; show completed and pending steps. |
| Reconciliation required | Unknown divergence remains | Human/domain action may be required. | Exceptional state; record evidence and ownership. |

No outcome may be silently converted into success. Transport-specific exceptions and status codes are outside this ADR.

## Consequences

### Positive consequences

- Canonical ownership survives changes in storage, providers, applications and deployment.
- Stale writes, duplicates and partial failures become explicit rather than hidden.
- Domain transactions remain bounded while multi-domain work can progress and recover safely.
- Dashboards and reporting can be optimised without becoming competing authorities.
- Legacy systems can coexist without freezing their layouts into the Canon.
- ADR-005 events gain a recoverable publication relationship to canonical facts.

### Trade-offs and risks

- Implementations must retain more explicit workflow, comparison and integration-processing state.
- Eventual consistency requires visible intermediate states and operational reconciliation.
- Domain queries and projections require deliberate design instead of unrestricted storage access.
- Some workflows cannot be fully automated until compensation, ownership or conflict policy is governed.
- Physical consolidation must preserve logical contracts, which adds discipline even in a single deployment.

## Explicit non-decisions

This ADR does not decide:

- database engine or relational, document, graph, key-value or other storage model;
- ORM, persistence framework or repository implementation pattern;
- physical schema, tables, collections, files, indexes, partitions or query language;
- connection, pooling, cache, backup or restoration technology;
- isolation level, locking implementation or distributed-transaction technology;
- event broker, transport, serialization or hosting platform;
- outbox, inbox, change-data-capture or durable-publication implementation;
- event sourcing;
- projection storage, freshness objective or retention duration;
- deployment topology or database-per-service architecture;
- repository-per-schema mapping or full aggregate catalogue;
- domain-specific merge, precedence, compensation or conflict policy not present in BDRs;
- universal idempotency/audit retention periods;
- full audit implementation or error transport contract;
- full Booking-to-Production workflow reserved for ADR-009;
- detailed Hospitality-dashboard projection design reserved for ADR-007;
- legacy cutover and retirement policy reserved for ADR-010.

## Alternatives considered

### One shared data-access layer

Rejected because it would expose persistence concerns across domains, weaken ownership and allow applications to bypass invariants.

### One repository for every schema

Rejected because schemas describe contracts, not consistency scopes. It would manufacture boundaries unsupported by business invariants.

### One repository for every domain

Rejected as a universal rule because one domain may contain more than one consistency boundary and several related records may need one contract.

### Distributed transaction across a complete workflow

Rejected as the architecture baseline because logical domains retain independent acceptance and may share or not share physical deployment. It would hide partial completion and couple technology choices.

### Universal last-write-wins

Rejected because recency does not determine business precedence and silent overwrites conflict with governed history and authority.

### Provider or legacy store as canonical repository

Rejected as an inference. Operational storage becomes canonical only through an explicit authority decision, not through current use.

### Event stream as canonical persistence and audit

Rejected as an assumption. ADR-005 does not select event sourcing, and event delivery is not a complete audit model.

## Questions returned to the BDR process

These questions do not block this architectural contract. They must be resolved before a dependent implementation invents policy:

- Which domain-specific changes, if any, permit automatic merging or precedence?
- Which business outcomes require compensation after a later cross-domain refusal or failure?
- Which authoritative decisions, if any, may tolerate a known projection age?
- What retention and privacy periods apply to command-idempotency, audit and reconciliation evidence?
- Does a common Audit domain/repository have governed business ownership, or are only shared conventions required?
- What business thresholds govern escalation and manual reconciliation?
- Which current legacy systems hold canonical authority, execution responsibility or both during each migration stage where the current-system map records TODO?

## Required follow-up decisions

1. [ADR-007: Projection and Dashboard Boundary](README.md) — define projection ownership, freshness, rebuild and reporting access, using the Hospitality dashboard as the first case study.
2. ADR-008: Identity and AUTHMOD Enforcement Boundary.
3. ADR-009: Booking-to-Production Orchestration.
4. ADR-010: Legacy Coexistence and Retirement.
5. ADR-011: Notification Contract, only when a shared capability is authorised.

## Traceability summary

| ADR-006 conclusion | Primary support |
|---|---|
| Domain-owned repositories and no direct cross-domain mutation | ADR-001; Packs 1–8 ownership boundaries |
| Invariant-led consistency scopes and preserved history | SVC-005; BOOK-004; BOOK-006; PROD-004; TYPE-003; Pack schemas |
| AUTHMOD and access remain outside repository authority | ROLE-002–007; Pack 2 schemas; ADR-001 |
| Optimistic comparison and explicit stale conflict | Repeated Pack record-version evidence; ADR-001 enforcement boundary; platform explicit-failure principle |
| Idempotent commands distinct from event deduplication | ADR-005; BOOK-007 provenance; workflow catalogue |
| Durable fact precedes authoritative event and publication is recoverable | ADR-001; ADR-005 |
| Cross-domain work is coordinated, observable and not one transaction | ADR-001; Booking/Production separation in BOOK/PROD BDRs and ADR-004 |
| Projections and reports are derived and non-authoritative | ADR-001; current-system map; platform-domain map |
| Provider and legacy systems remain behind adapters | BOOK-007; provider-mapping principles; ADR-001; current-system map |
| Audit is attributable but distinct from canonical state/events | ROLE BDRs; Pack audit evidence; ADR-001; ADR-005 |

## Validation notes

This ADR was reviewed against ADR-001, ADR-005, Packs 1–8 BDRs, schemas and traceability records, the Stage 5 closure, Stage 6 record, current-system evidence, platform principles and FIKA Core catalogues. It changes no BDR Decision, schema, fixture, inventory, production repository or infrastructure configuration.
