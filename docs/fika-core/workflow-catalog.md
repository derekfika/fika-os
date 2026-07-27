# Workflow and Orchestration Catalogue

## Status

Stage 6 supporting catalogue governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md) and [ADR-005](../decisions/ADR-005-domain-event-and-integration-contract.md) through [ADR-011](../decisions/ADR-011-notification-generation-and-delivery.md). It distinguishes a domain command from a completed domain fact and from cross-domain orchestration. It specifies no workflow engine, migration platform or notification provider.

## Boundary rule

A domain command changes one domain under that domain's rules. Orchestration coordinates multiple domains or providers after each domain has independently accepted its part. Shared steps do not become FIKA Core merely because several workflows use them.

ADR-005 governs how completed facts are published. Orchestration consumes an integration event and issues a new command for an intended downstream action; it never publishes the desired outcome as if that action had already succeeded.

ADR-006 governs persisted workflow state, partial completion, stale conflicts, command idempotency and reconciliation. A cross-domain workflow does not imply one distributed transaction, and compensation is an authorised business action rather than a technical rollback.

ADR-007 governs workflow projections and dashboard visibility. Projected progress does not overwrite participating-domain state, and a dashboard action must cross an authorised command boundary that revalidates current canonical state.

ADR-008 governs trusted actor context. Orchestration preserves initiating, executing and represented actors, revalidates authority at each protected domain/provider step, and never lets a service identity impersonate a human for convenience.

## Booking submission

- Owner of business decision: Booking.
- Input: validated direct submission or normalised legacy request with stable source reference.
- Domain result: accepted Booking version or structured rejection.
- Orchestration consequences: projection update and notification intent; later Production evaluation only when the governed trigger applies.
- Exclusions: parser detail, provider payload, dashboard workflow state and Production state.

## Booking amendment, cancellation or decline

- Owner: Booking while the action remains within its governed responsibility and authority.
- Domain result: preserved history and new effective version/action record; no overwrite.
- Orchestration consequences: notify Production when a linked order exists, update projections and notify relevant actors under later policy.
- Cross-domain rule: Production decides its operational response based on whether work has started.

## Booking-to-Production creation

- Source authority: attributable Booking version.
- Eligibility owner: Production under PROD-001 and Pack 6 resolution.
- Result: zero, one or more Production Orders with Production-owned lifecycle and routing.
- Required controls: idempotency, source-version traceability, independent authority checks, durable progress, explicit partial outcomes and reconciliation under ADR-009.
- Amendment and cancellation: Booking records the governed commercial action; Production independently applies the permitted operational consequence according to whether work has started.
- Deferred business policy: the exact Booking status trigger, hold prerequisites, multi-order all-or-nothing expectations, post-start disposition and notification policy return to the BDR process.

## Legacy coexistence, cutover and retirement

- Owner: application/platform orchestration coordinates the transition; participating domains retain canonical ownership.
- Input: a bounded migration unit with declared authority direction, identities, dependencies, evidence requirements and fallback constraints.
- Result: scoped shadow/comparison evidence, governed cutover outcome, controlled coexistence, or separately approved retirement/decommissioning evidence.
- Controls: one canonical writer per fact/scope/period, provenance, duplicate-effect prevention, divergence visibility, authorised reconciliation and attributable checkpoints.
- Exclusions: migration tooling, cutover schedule, universal thresholds, retention policy and business acceptance ownership where not governed.

## Notification generation and delivery

- Owner: the source domain owns the fact; declared policy owners govern purpose/recipient/content; the notification boundary owns accepted intent, preparation, attempts and reconciliation.
- Input: attributable source fact or authorised request plus current policy, actor, recipient and disclosure context.
- Result: ineligible/suppressed/review outcome or one stable notification occurrence with per-recipient attempts and qualified provider observations.
- Controls: occurrence and attempt idempotency, command-time authority, minimisation, safe rendering, explicit partiality and replay without external effects by default.
- Exclusions: recipients, channels, consent basis, wording, delivery targets, retry schedule, escalation, acknowledgement consequence and retention where not governed.

## Event approval

- Owner: Event.
- Required result: auditable approval record identifying person, role or delegated authority, decision, timestamp and conditions where applicable.
- Provider consequences: publication, notification and calendar delivery remain separate and are not implied by approval.
- Deferred: lifecycle and publication policy.

## Recurring Service scheduling

- Owner: Service.
- Result: effective-dated Recurring Schedule or governed exception without overwriting prior schedule history.
- Operational consequence: may provide planned demand input, but does not turn a Hospitality Booking into a Service Occurrence.
- Deferred: final canonical name for the shared fulfilment/work input.

## Mobilisation

- Owner: Mobilisation.
- Result: governed programme, tasks, accountable role, readiness assessment and history.
- Cross-domain coordination: Capabilities and affected domains contribute evidence without transferring ownership.
- Exclusions: MNK phase names as Canon and routine change below the deferred materiality threshold.

## Brand variation

- Owner: Brand.
- Result: authorised variation plus at least one separate Brand Assurance Record.
- Separation: assurance records verification; Marketing and Brand approval records authorisation.
- Delivery: application rendering and asset storage are downstream concerns.

## Waste recording

- Owner: Waste.
- Result: Waste Event and immediate Waste Disposition.
- Downstream: Reporting consumes; a future Improvement Action may reference the event after its domain is governed.

## Provider workflows

Quote generation, document rendering, calendar synchronisation and notification delivery are currently orchestration/provider capabilities unless later BDRs establish domain ownership. Their adapters must not define commercial, Event, Service or Production meaning.

## Operational workflows not yet governed

Equipment fault, Media indexing, Logistics fulfilment, Workforce planning and reporting publication remain candidates. Existing operational evidence may inform discovery but does not authorise a canonical workflow.

## Common orchestration requirements

Every cross-domain workflow must declare:

- initiating business fact or command;
- owning domain for each decision;
- actor and authority context;
- canonical versions and stable references used;
- idempotency, correlation and causation context;
- failure, retry, compensation and reconciliation policy;
- projection and provider side effects;
- audit evidence and operational observability;
- responsible acceptance role for any migration or cutover.

## Open questions

- Domain-specific compensation rules where business authority is unresolved.
- Notification generation policy and recipient ownership.
- Projection freshness and replay expectations.
