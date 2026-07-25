# ADR-005: Domain Event and Integration Contract

- Status: Accepted
- Date: 2026-07-25
- Stage: Stage 6 — Platform Architecture
- Decision owners: Platform Governance, constrained by each originating domain's approved business authority
- Depends on: ADR-001
- Related records: ADR-003 and ADR-004 remain supporting decisions within this boundary
- Supersedes: none

## Context

[ADR-001](ADR-001-stage-6-platform-boundaries.md) established that logical domains own canonical business meaning and that application orchestration may respond to committed domain events. It reserved this ADR to define the event envelope, idempotency, ordering, delivery and replay contract before cross-domain event delivery is implemented.

The governed Packs already use stable identities, versions, effective dates, occurrence and recording times, provenance and audit references. Current operational systems also exchange messages, Calendar records, files, emails and Sheet changes. Those current representations are useful integration evidence, but they are not a canonical event contract and must not redefine business meaning.

FIKA OS needs a technology-neutral way to communicate completed business facts while preserving domain ownership, AUTHMOD enforcement, storage independence and gradual migration. The contract must work whether logical domain services share a deployment or are separated later.

## Evidence considered

| Evidence | Supported conclusion | Authority |
|---|---|---|
| [ADR-001](ADR-001-stage-6-platform-boundaries.md) | A domain event follows an accepted and persisted domain change; consumers tolerate repeats; events are separate from notifications and audit; orchestration cannot bypass a domain. | Accepted architecture |
| [Platform principles](../platform-principles.md) | Stable contracts, source-of-truth clarity, duplicate-safe automation, explicit failure, observability and gradual migration are required. | Canonical principles |
| [ROLE-002](../business-decisions/role-002-roles-responsibilities-assignments.md), [ROLE-003](../business-decisions/role-003-permission-actions.md), [ROLE-005](../business-decisions/role-005-approval-publication-separation.md) and [ROLE-006](../business-decisions/role-006-access-boundaries.md) | Assignment, authority, approval, publication and access are separate; possessing technical access does not grant business authority. | Canonical Decision sections |
| [BOOK-004](../business-decisions/book-004-immutable-pricing-amendments.md), [BOOK-006](../business-decisions/book-006-booking-amendment-cancellation-decline.md) and [SVC-005](../business-decisions/svc-005-recurring-schedule-governance.md) | Accepted facts and history are not silently overwritten; amendments and exceptions preserve reason, approval, effective scope and audit history. | Canonical Decision sections |
| [BOOK-007](../business-decisions/book-007-booking-source-references.md) and [provider-mapping principles](../platform-methodology/provider-mapping-principles.md) | Source references are channel-neutral; parser/provider details remain outside canonical business meaning; incomplete input is not guessed. | Canonical Decision and method |
| [SVC-008](../business-decisions/svc-008-service-and-event-boundary.md), [EVT-001](../business-decisions/evt-001-event-qualification.md) and [Pack 5 traceability](../schema-reviews/pack-5-bdr-to-schema-traceability.md) | The canonical Event domain record is a business concept and must remain distinct from an architectural domain event. | Canonical Decisions and integrated schema evidence |
| [PROD-001](../business-decisions/prod-001-production-order-eligibility.md), [PROD-004](../business-decisions/prod-004-production-amendments-cancellations.md), [ADR-004](ADR-004-booking-to-production-boundary.md) and [Pack 6 traceability](../schema-reviews/pack-6-bdr-to-schema-traceability.md) | Booking and Production retain separate ownership; attributable versions, preserved change history, notifications after a fact and human review where required are supported. | Canonical Decisions, accepted architecture and integrated schema evidence |
| [Pack 1 traceability](../schema-reviews/pack-1-bdr-to-schema-traceability.md) and [OPLOC lifecycle transition](../../schemas/pack-1/operational-location-lifecycle-transition.schema.json) | Stable transition identity, effective occurrence time and approval evidence are recurring governed patterns. | Integrated schema evidence |
| [Pack 2 traceability](../schema-reviews/pack-2-bdr-to-schema-traceability.md) and [authority grant](../../schemas/pack-2/authority-grant.schema.json) | Actor/authority context must reference effective governed records rather than become a new permission model in the envelope. | Integrated schema evidence |
| [Pack 4 traceability](../schema-reviews/pack-4-bdr-to-schema-traceability.md) and [Booking amendment action](../../schemas/pack-4/booking-amendment-action.schema.json) | Record identity, source decisions, effective time and before/after versions support attributable change facts. | Integrated schema evidence |
| [Event schema](../../schemas/pack-5/event.schema.json), [Production Order schema](../../schemas/pack-6/production-order.schema.json), [Mobilisation schema](../../schemas/pack-7/mobilisation.schema.json) and [Waste Event schema](../../schemas/pack-8/waste-event.schema.json) | Stable subject identities, domain-owned states, occurrence/recording time, provenance and audit exist across domains without requiring one storage model. | Integrated schema evidence |
| [Current-system map](../current-system-map.md) | Gmail, Calendar, Drive, Sheets, dashboards and scanners are providers, projections or transition partners; they do not define canonical integration contracts. | Canonical current-state evidence |
| [Stage 5 closure](../stages/stage-5-closure-2026-07-25.md) | Packs 1–8 are the completed, validated schema baseline; event architecture must not change them. | Canonical stage record |

## Decision

FIKA OS will represent completed business facts as **domain events** owned by the domain where the fact occurred. A deliberately published representation used across a boundary is an **integration event**. FIKA Core owns only the domain-neutral envelope convention; the originating domain owns event meaning, type, payload contract and publication decision.

Event exchange is asynchronous in responsibility even when implemented in-process. Publication does not transfer ownership, delivery does not prove business processing, and no consumer may directly complete or alter the producer's canonical record.

### Event taxonomy

| Term | Meaning | Critical boundary |
|---|---|---|
| Domain event | A meaningful completed business fact in canonical FIKA language, owned by the logical domain in which it occurred. | Past-tense fact after valid durable change; never an instruction. |
| Integration event | A deliberately stable published contract communicating a domain fact across a domain, application or system boundary. | Derived from authoritative meaning; not a second source of truth. |
| Command | A request that an owning domain attempt an action. It may be refused. | Requires validation and authority; must not be disguised as a completed fact. |
| Query | A request for information that does not itself change canonical state. | Does not authorise a later mutation. |
| Notification | A user- or provider-facing communication caused by a fact or workflow condition. | Delivery status is separate from the underlying business result. |
| Provider event or webhook | An external provider's claim that something occurred in its own system. | Untrusted external observation until an adapter maps and the owning domain accepts any resulting command. |
| Audit entry | Governed evidence of who or what acted, under which authority, what was attempted or changed and with what result. | An event may correlate to audit; the event stream is not automatically the complete audit record. |
| Event-domain record | The canonical bespoke business activity governed by EVT-001, EVT-002 and SVC-008. | Capitalised **Event** remains a business concept, not an architectural message. |

### Domain-event boundary

A domain event:

- is named in canonical, past-tense business language;
- represents a completed fact the owning domain has accepted and durably recorded;
- reflects a valid state transition or recognised occurrence supported by the domain's authority;
- carries stable canonical subject identity;
- is immutable after recording;
- does not instruct another domain to produce a desired outcome;
- does not transfer ownership of the subject;
- excludes provider transport, storage and application details.

Not every record write needs a domain event, and not every internal domain event must be published. The domain owner decides which facts exist and which are publishable under approved business policy. Architecture does not create that catalogue.

### Integration-event boundary

An integration event is a versioned consumer contract derived from one completed domain fact. It may be structurally similar to the internal domain event, but it is deliberately minimised, stabilised and reviewed for cross-boundary use.

An integration event:

- may omit sensitive, internal or persistence-specific detail;
- may carry only stable references where consumers can retrieve an authorised current view;
- cannot broaden or reinterpret the originating fact;
- cannot create a second lifecycle for the producer's record;
- remains attributable to the originating domain and subject;
- may be published to selected consumers rather than universally.

If one internal fact produces a materially distinct integration representation, that integration event has its own event identity and references the source through causation. It still describes the same authoritative business occurrence rather than creating a new source of truth.

## Logical event envelope

The envelope is a logical contract, not a transport header format. All timestamps use ISO 8601 with an explicit offset or UTC designator.

| Field | Requirement | Purpose and supplier | Envelope or payload | Sensitivity and consumer use |
|---|---|---|---|---|
| `envelopeVersion` | Required | FIKA Core identifies the envelope contract understood by producer and consumer. | Envelope | Non-sensitive; consumers validate it but do not use it as business meaning. |
| `eventId` | Required | Producer assigns an immutable FIKA event identity; redelivery preserves it. | Envelope | Non-secret; used for deduplication and traceability, not subject identity. |
| `eventType` | Required | Originating domain supplies the registered canonical past-tense type. | Envelope | Consumers use it to select the contract, never to infer undocumented facts. |
| `eventContractVersion` | Required | Event-type owner identifies the payload contract version. | Envelope | Consumers validate compatibility; it is independent from schema/provider versions. |
| `occurredAt` | Required | Originating domain records when the business fact occurred. | Envelope | May be business-sensitive; can support authorised temporal decisions defined by the event contract. |
| `recordedAt` | Required | Originating domain records when the fact became durable. | Envelope | Operational/audit context; does not replace occurrence time. |
| `publishedAt` | Conditionally required for an integration event | Publisher records first acceptance into the integration boundary. Delivery-attempt times remain processing metadata. | Envelope | Operational latency and reconciliation only; not business occurrence time. |
| `producerDomain` | Required | Originating logical domain names the owner of the fact. | Envelope | Used for ownership, routing and contract discovery; does not imply separate deployment. |
| `subject` | Required | Originating domain supplies canonical `type` and `id`; `version` is conditionally required when the fact concerns a versioned aggregate state. | Envelope | Consumers may identify/retrieve the authority; they must not mutate it directly. |
| `correlationId` | Required | Initial boundary creates it; subsequent orchestration preserves it across related work. A root event may start a new correlation. | Envelope | Operational grouping only; never grants authority or proves one transaction. |
| `causationId` | Conditionally required | Producer references the identifiable command or prior event that directly caused this event. Omitted only when no such cause exists. | Envelope | Traceability and workflow analysis; not authority. |
| `actorContext` | Conditionally required | Domain service references initiating actor, Assignment and/or Authority Grant when a governed human or system action caused the fact. | Envelope | Potentially sensitive; reference-minimised, access-controlled, and never re-evaluated as current permission. |
| `contextReferences` | Optional | Producer supplies stable Client, OPLOC or other canonical references only when useful for authorised routing or filtering. | Envelope | Routing hints, not an authoritative copy; consumers verify business meaning with the owning domain. No `tenant` is defined because the Canon has no Tenant concept. |
| `payload` | Required | Event-type owner supplies the minimum contract needed to communicate the fact. | Payload | May support business decisions only for explicitly defined fields and the stated event version. |
| `metadata` | Optional and contract-constrained | Publisher supplies domain-neutral technical context that the event contract explicitly permits. | Envelope | Must not contain business facts, provider payloads, secrets or free-form dumping; consumers cannot base business decisions on it. |
| `traceContext` | Optional | Processing layer carries opaque diagnostic correlation where required. | Envelope | Observability only; must not carry authority or sensitive payload copies. |

Event delivery-attempt identity, retry count, provider callback identity, adapter diagnostics, quarantine state and replay execution state belong to integration checkpoints or processing records, not the immutable business-event envelope.

### Non-normative example

The following illustrates the envelope only. `ProductionOrderCreated` is an example grounded in the existence of the governed Production Order; it does not define the trigger or complete Booking-to-Production workflow reserved for ADR-009.

```json
{
  "envelopeVersion": "1",
  "eventId": "evt_example_01",
  "eventType": "ProductionOrderCreated",
  "eventContractVersion": "1",
  "occurredAt": "2026-07-25T10:15:00Z",
  "recordedAt": "2026-07-25T10:15:01Z",
  "publishedAt": "2026-07-25T10:15:02Z",
  "producerDomain": "Production",
  "subject": {
    "type": "ProductionOrder",
    "id": "production-order-example",
    "version": 1
  },
  "correlationId": "correlation-example",
  "causationId": "command-example",
  "payload": {
    "sourceBookingId": "booking-example",
    "sourceBookingVersion": 3
  }
}
```

The identifiers are fictional and define no production format or ID algorithm.

## Naming and ownership

- Event types use canonical PascalCase past-tense business language, such as the illustrative `ProductionOrderCreated` or `BookingAmendmentRecorded`.
- Examples are not an adopted event catalogue and do not authorise a new transition.
- A type name is globally unambiguous when combined with its `producerDomain`; names must not use provider, application, screen, Sheet or transport vocabulary.
- The originating domain owns the type, semantics, payload, compatibility and decision to publish.
- Only the owning domain may authoritatively record the fact. An orchestration or adapter may transport it but must not impersonate the domain.
- Authoritative publication begins only after the fact is durable and uses a publisher acting for the originating domain; the system actor and consumer access remain subject to the applicable technical and AUTHMOD controls.
- Technical publication of an integration event is not automatically the AUTHMOD `Publish` business action. Where exposing the fact makes governed information operationally active for an audience, the owning domain must define and enforce any required `Publish` authority rather than allowing architecture to infer it.
- Consumers cannot rename or reinterpret the fact as a different canonical meaning. A consumer may issue its own authorised command and, if accepted, its domain may record a new fact.
- Event publication does not transfer ownership of the subject or its lifecycle.

## Payload rules

- Communicate the fact required by the declared consumers; do not mirror persistence objects or copy a full aggregate by default.
- Carry canonical identifiers and attributable subject versions where they are needed for correctness.
- Refer to related domain records rather than embedding an entire cross-domain graph.
- Include a field only when its meaning is owned, documented and compatible under the event contract.
- Exclude secrets, credentials, provider payloads, parser internals, UI workflow state and unrestricted personal data.
- Use separate, access-appropriate integration contracts where audiences require different information; do not publish one maximal payload.
- Consumers may act on a payload field only when that field's contract explicitly supports the decision. Otherwise they query the authoritative domain under their own permission.
- A late event never authorises overwriting a newer canonical record.

## Identity

- `eventId` identifies one immutable logical event occurrence and remains stable across redelivery.
- A delivery attempt has a different processing identity outside the event.
- Provider message identity remains adapter metadata and does not replace `eventId`.
- Canonical business-record identity remains in `subject` and does not replace `eventId`.
- A derived integration event with distinct semantics has a new `eventId` and a `causationId` linking it to its source event.
- Correction or supersession creates a new event under an approved domain rule; the original event is not edited or reused.

## Versioning and compatibility

Four version concerns remain separate:

| Version | Governs |
|---|---|
| Envelope version | Domain-neutral envelope fields and semantics. |
| Event-contract version | One event type's payload, requiredness and meaning. |
| Canonical schema version | The subject domain record contract. |
| Provider API or mapping version | External/provider representation behind an adapter. |

An event version is not required to match the subject's canonical schema version.

### Compatible change

A change is compatible only when existing consumers can continue safely without changed meaning. Normally this permits adding an optional field with documented semantics and a safe absence case. Consumers must ignore unknown optional fields while still rejecting an unknown required envelope version or unsupported event-contract version.

### Breaking change

A new event-contract version is required when a change:

- removes or renames a field;
- makes an optional field required;
- changes a field's type, unit, format, cardinality or nullability incompatibly;
- narrows accepted values or changes status/enum meaning;
- changes the semantic meaning of an existing name;
- changes identity, occurrence-time or ownership interpretation;
- exposes materially different sensitivity or audience assumptions.

An unchanged field name with changed meaning is still breaking. A widened enum is compatible only when the existing consumer contract already requires unknown values to be handled safely; otherwise it is breaking.

### Transition and retirement

- Producers and consumers may support multiple event-contract versions during a controlled transition.
- The owner records version status, compatibility position and intended withdrawal; exact notation is deferred.
- Producers and registered consumers test every supported contract version and its compatibility expectations before activation.
- Retirement requires a known consumer inventory, migration evidence, observability and no unresolved dependency.
- Event type names remain semantic names; version is carried separately rather than hidden in a renamed business fact.
- Legacy adapters state which event version and provider-mapping version they produce or consume.
- Future JSON Schema may describe event contracts, but this ADR chooses no serialization or schema technology and creates no schema.

## Delivery assumptions

- FIKA OS makes no exactly-once delivery assumption.
- At-least-once processing is the safe logical design baseline: an integration event may not yet have arrived while recovery is pending, and may later arrive once or more than once, delayed or out of order.
- Implementations must make accepted publication durable or explicitly reconcilable; silent event loss is not acceptable.
- Consumers acknowledge receipt/processing separately from business completion.
- A delivery acknowledgement means only what that integration boundary defines; it never proves the receiving domain accepted a command or completed work.
- Failure classification, retry and reconciliation are mandatory design concerns, but infrastructure and timings are deferred.

## Idempotency

- Consumers validate the supported contract version, then deduplicate by stable `eventId` within their own consumer scope so the same fact cannot repeat an effect merely because it is represented during a version transition.
- Deduplicating receipt does not make downstream business commands or external effects safe automatically.
- Any command issued because of an event carries its own stable idempotency context and passes the receiving domain's validation and authority checks.
- Email, provider writes, payments or other irreversible effects require effect-specific idempotency or reconciliation.
- Repeating an event delivery never grants permission to repeat a business action.
- Deduplication/checkpoint history must survive the period in which redelivery or replay is possible; exact retention is deferred.

## Ordering

- There is no global ordering guarantee across FIKA OS.
- Consumers do not assume order across domains, event types or subjects.
- Per-subject order may be relied upon only where a later contract explicitly guarantees it and supplies a governed subject version or sequence.
- `occurredAt`, `recordedAt`, `publishedAt` and arrival time are distinct and are not interchangeable ordering keys.
- A consumer receiving an older subject version after a newer one must not overwrite newer state. It may ignore, reconcile, rebuild or route the discrepancy according to its contract.
- One user action may create several independently committed events; correlation does not make them one atomic domain transaction.

## Correlation, causation and orchestration

`correlationId` groups related processing across a workflow. `causationId` identifies the immediate command or event that led to a fact. Neither changes domain ownership or establishes authority.

Application orchestration may consume an integration event and issue a command asking another domain to act. The receiving domain independently authenticates the actor/system context, evaluates AUTHMOD, validates its current state and may accept or refuse the command. Orchestration must not publish the requested outcome as if it already occurred.

For example, an eligible committed Booking fact may cause orchestration to request Production creation. Production owns eligibility and records any resulting Production Order fact. This is illustrative only; trigger, command, compensation and reconciliation details remain reserved for ADR-009.

Workflow status is orchestration/projection state and remains separate from domain lifecycle state. If later business policy defines compensation, the compensating action is requested by a command and any completed result is recorded as a new fact; ADR-005 does not invent compensation policy.

## Failure and retry principles

- Classify failures at least as contract rejection, authority/business refusal, transient processing failure, permanent processing failure or uncertain outcome.
- Retry only work classified as safe to repeat and preserve the same event identity for redelivery.
- Retry must be bounded and observable; exact counts, delays and escalation are not decided here.
- Invalid, untrusted, unsupported or repeatedly failing input enters a visible quarantine or equivalent governed review state rather than an infinite retry loop.
- Poison input and unsupported contract versions must identify the event, consumer, reason and last safe processing point without copying sensitive payloads into uncontrolled logs.
- Failed publication and uncertain consumption require reconciliation against the authoritative domain record and integration checkpoint.
- No failure path may silently manufacture missing business facts or mark business work complete.

“Dead letter”, “quarantine” and “checkpoint” are logical responsibilities, not selected infrastructure.

## Replay and projection rebuilding

- ADR-005 does **not** require event sourcing.
- Event-sourced persistence remains permitted only after a separate repository decision proves it satisfies canonical, audit, retention and migration requirements.
- An integration event is not assumed to be a complete durable history. A contract must explicitly designate completeness and retention before it can be the sole replay source.
- Projections may rebuild from authoritative canonical records and retained events where the projection contract declares the source and reconciliation method.
- Reprocessing after a consumer defect preserves original `eventId`, `occurredAt`, `recordedAt` and payload. Replay execution details are recorded separately.
- Replay does not silently rewrite canonical history or re-perform a real-world business action.
- External side effects are suppressed during rebuild/replay by default. Any deliberate re-execution requires an explicit effect contract, authority and idempotency/reconciliation control.
- Corrected or superseded facts are represented by later governed records/events; replay applies them according to subject version and contract rather than editing earlier events.

## Provider and legacy boundaries

### Inbound

```text
Provider webhook or legacy observation
  → inbound adapter validation and deduplication
  → explicit mapping with provider provenance
  → authorised command or recorded external observation
  → owning domain validation and decision
  → canonical change, if accepted
  → domain event
```

A webhook is never trusted as a canonical fact merely because a provider signed or delivered it. Provider callback identity, mapping version, raw payload reference and adapter diagnostics remain integration metadata. Duplicate callbacks reuse adapter deduplication and do not create duplicate domain actions.

Incomplete, ambiguous, unsupported or out-of-order input is rejected, quarantined or reconciled. It is not completed by inference.

### Outbound

```text
Committed canonical fact
  → selected integration event
  → authorised orchestration or outbound adapter
  → provider request
  → provider outcome and integration checkpoint
```

Provider success or failure does not rewrite the originating fact. Any business consequence returns through the owning domain under an explicit command and policy.

Legacy spreadsheets, dashboards, messages and Calendar records do not automatically become canonical event publishers. Stable legacy workflows may continue while adapters expose observable mappings, source references, deduplication and reconciliation. No migration or retirement is authorised by this ADR.

## Security and privacy

- Receiving or possessing an event grants no permission to view related records or perform an action.
- Consumers enforce current Capability, Configuration, access and AUTHMOD rules before changing canonical state.
- Event contracts minimise personal, commercial, allergen, workforce and other sensitive information according to the owning domain's classification.
- Actor context uses stable references and minimum necessary authority evidence; it is not a portable permission grant.
- Secrets, tokens, credentials and raw provider payloads are prohibited from event payloads and general metadata.
- Access to event payloads, retained processing records and replay capability follows least privilege and effective scope.
- Retention, deletion and redaction periods require domain/privacy authority and are not set here.

## Audit and observability relationship

Event metadata can correlate domain audit, orchestration and integration processing, but it does not replace the governed audit model. Audit records may need details deliberately excluded from an integration event, while technical logs may contain only safe operational summaries.

Implementations must distinguish and observe:

- event recorded but publication unconfirmed;
- publication accepted;
- delivery attempt and acknowledgement;
- contract rejection;
- duplicate detection;
- consumer processing success or failure;
- business command acceptance or refusal;
- retry, quarantine and reconciliation state;
- projection lag or rebuild progress.

Logs, metrics and traces must not become uncontrolled copies of event payloads. Technical processing state remains separate from business state. This ADR selects no monitoring, logging or tracing product and does not define the full audit contract.

## Consequences

### Positive consequences

- Completed facts can cross logical boundaries without transferring domain ownership.
- Consumers are protected from provider and persistence models.
- Duplicate, delayed and out-of-order delivery are explicit design conditions.
- Correlation and causation support diagnosis without pretending cross-domain work is one transaction.
- Projections can be rebuilt safely where their source contract supports it.
- Legacy workflows may coexist behind observable adapters.
- FIKA Core remains narrow and technology-neutral.

### Trade-offs and risks

- Producers must maintain deliberately stable event contracts in addition to canonical record contracts.
- Consumers need checkpoints, compatibility tests and explicit stale-event handling.
- Data minimisation may require authorised queries rather than convenient large payloads.
- Without exactly-once assumptions, effect-specific idempotency and reconciliation add design work.
- Event publication consistency cannot be completed until ADR-006 defines repository and consistency guarantees.
- A poorly governed event catalogue could duplicate business meaning; domain ownership and BDR escalation are therefore mandatory.

## Explicit non-decisions

ADR-005 does not select or define:

- an event broker, message provider or queue product;
- transport protocol;
- serialization format or schema language;
- programming language or framework;
- cloud, hosting or deployment platform;
- database or event-store implementation;
- outbox, inbox or saga implementation;
- queue topology, topic layout or partitioning;
- retention duration;
- retry counts, delays or escalation timings;
- a full event catalogue;
- a full audit contract;
- a full notification contract;
- event sourcing;
- microservices or any deployment topology;
- the Hospitality-to-CPU/Booking-to-Production workflow reserved for ADR-009;
- any Stage 5 schema change.

## Alternatives considered

### Treat commands as events

Rejected because a requested outcome may be refused and must pass the receiving domain's authority and validation boundaries.

### Publish full canonical aggregates

Rejected because this leaks sensitive/persistence detail, couples consumers to unrelated changes and encourages competing copies of truth.

### Use provider webhooks as canonical events

Rejected because providers do not own FIKA business meaning and external observations may be duplicated, incomplete or semantically different.

### Require exactly-once delivery

Rejected because it is not portable across storage, transports and external effects and can conceal uncertainty rather than eliminate it.

### Guarantee global ordering

Rejected because unrelated domains and subjects have no governed global sequence, and a timestamp does not create one.

### Declare the event stream the audit log or canonical store

Rejected because Stage 5 establishes canonical records and governed audit needs, not event sourcing or one complete event stream.

### Avoid events and use direct cross-domain writes

Rejected because direct writes bypass domain ownership, validation, authority and independent lifecycle.

## Questions returned to the BDR process

The following do not block this architectural contract but cannot be invented by architecture:

- Which domain facts exist as named domain events and which are publishable integration events.
- Business triggers, eligibility and audiences for each event type.
- Event-domain lifecycle and publication authority still deferred by EVT-002.
- Notification recipients, thresholds, escalation and evidence policy.
- Business meaning of compensating actions where a later workflow requires them.
- Domain-specific data classification, retention, deletion and lawful-use rules.
- Whether particular provider observations have approved semantic equivalence to a FIKA fact.
- Any undeveloped domain meaning required by Logistics, Workforce, Media, Equipment, Reporting or Improvement Action.

## Required follow-up decisions

| Decision | Dependency created by ADR-005 |
|---|---|
| ADR-006 Repository and Consistency Contract | Define durable record/publication boundary, concurrency, atomicity limits, uncertain outcomes and reconciliation responsibilities. This is the next bounded task. |
| ADR-007 Projection and Dashboard Boundary | Apply replay-source, freshness, rebuild, sensitive-field and stale-event rules to projections. |
| ADR-008 Identity and AUTHMOD Enforcement Boundary | Define authentication-to-actor mapping and safe authority-context propagation. |
| ADR-009 Booking-to-Production Orchestration | Define the specific Booking fact, Production command, idempotency, failure, compensation and reconciliation workflow. |
| ADR-010 Legacy Coexistence and Retirement | Define adapter cutover, mapping evidence, reconciliation, rollback and retirement acceptance. |
| ADR-011 Notification Generation and Delivery | Define notification intent, recipient policy, channel delivery, effect idempotency and audit. |

## Traceability summary

This decision implements the domain, ownership, adapter, projection and narrow-Core boundaries accepted by ADR-001. It uses stable identity, time, provenance, audit and authority patterns evidenced across Packs 1–8. It creates no business event catalogue, schema, provider mapping or implementation and changes no Stage 5 authority.
