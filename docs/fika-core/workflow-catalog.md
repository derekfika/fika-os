# FIKA Core Workflow Catalogue

## Purpose

Workflows coordinate business outcomes across services. The catalogue defines conceptual inputs, outputs, authority and boundaries—not implementation, endpoints or orchestration technology.

Every implemented workflow must later define idempotency, expected versions, permission checks, validation, audit, partial failure, retry, compensation, notifications and operational ownership.

## Booking Submission

- **Owner:** Booking domain; business owner TODO.
- **Inputs:** Validated submission command; site/application context; source channel and stable reference/idempotency; customer/service/item/dietary/acknowledgement intent.
- **Outputs:** Authoritative booking ID/version and commercial status; frozen pricing; validation result; audit evidence; projection/effect intents.
- **Responsibilities:** Authorise; resolve configuration/catalogue; validate; calculate authoritative pricing; prevent duplicates; persist booking; initiate projections/notifications.
- **Boundary:** Direct and legacy adapters emit the same command while preserving provenance. Projection or notification failure must not create a second booking.

## Booking Amendment

- **Owner:** Booking domain; amendment policy owner TODO.
- **Inputs:** Booking ID, expected version, actor, reason/effective context and proposed canonical changes.
- **Outputs:** New booking version or structured conflict/rejection; complete new pricing snapshot where required; downstream amendment intents.
- **Responsibilities:** Authorise fields/action; validate status and timing; reprice as approved; preserve prior version; propagate versioned change.
- **Boundary:** Dashboard edits cannot bypass this workflow. Production disposition is coordinated downstream, not embedded into booking.

## Booking Cancellation

- **Owner:** Booking domain; cancellation policy owner TODO.
- **Inputs:** Booking ID, expected version, actor, reason and cancellation context.
- **Outputs:** New cancelled booking version or rejection; quote/Calendar/production/notification disposition intents; audit record.
- **Responsibilities:** Authorise transition; protect against duplicates/stale versions; preserve history; coordinate downstream effects.
- **Boundary:** Already-prepared production and irreversible effects require explicit downstream policy; removing a projection does not cancel the booking.

## Quote Generation

- **Owner:** Quote domain; commercial owner TODO.
- **Inputs:** Stable source booking/event ID and version; approved pricing/brand/template context; actor and idempotency key.
- **Outputs:** Versioned quote record and document-generation intent; validation/errors; audit evidence.
- **Responsibilities:** Verify source version/eligibility; create consistent quote snapshot; prevent duplicates; request branded artefact; optionally initiate notification intent.
- **Boundary:** Quote status and document state do not overwrite booking status. Generated artefacts are separate document records.

## Production Creation

- **Owner:** Production domain; production owner TODO.
- **Inputs:** Eligible booking ID/version; ordered item units; service timing/location; dietaries/instructions; versioned production configuration.
- **Outputs:** Idempotent production order/lines linked to source version; warnings/manual-review outcome; audit and projection intents.
- **Responsibilities:** Validate eligibility; transform ordered items into production requirements; apply approved conversions; route facility/work centre; preserve traceability.
- **Boundary:** Production status, quantities, yields and prep state remain outside booking. Current Calendar-led ingestion remains a transitional adapter.

## Calendar Synchronisation

- **Owner:** Calendar projection capability; originating domain owns schedule meaning.
- **Inputs:** Source record ID/version; canonical schedule/location/participants; projection policy; idempotency reference.
- **Outputs:** Created/updated/removed projection record; provider reference; sync status/conflict; audit evidence.
- **Responsibilities:** Authorise; map canonical intent; prevent duplicates; reconcile updates/removal; classify retry/manual failures.
- **Boundary:** Calendar is never the authority for booking/event status or identity. Provider fields remain in adapter/projection records.

## Notification

- **Owner:** Notification Service; source domain owns the trigger decision.
- **Inputs:** Notification intent, source record/version, recipient references, template/policy/brand context, channels and deduplication key.
- **Outputs:** Notification record; channel delivery requests; attempt/outcome/suppression status.
- **Responsibilities:** Validate permission/preferences; render; route; deduplicate; retry safely; audit outcome.
- **Boundary:** Generation of notification meaning is separate from delivery. Delivery failure does not silently reverse authoritative domain state.

## Equipment Fault

- **Owner:** Equipment domain; operational owner TODO.
- **Inputs:** Equipment ID, reporter, site/location, observed condition, severity/evidence references and time.
- **Outputs:** Fault record/status; availability change; maintenance/escalation/notification intents; audit evidence.
- **Responsibilities:** Authorise/report; validate equipment; prevent duplicate open faults; restrict availability if policy requires; assign follow-up.
- **Boundary:** Commercial charges, event status and logistics movement are separate coordinated concerns.

## Mobilisation

- **Owner:** Mobilisation domain; business owner TODO.
- **Inputs:** Approved mobilisation scope, site/client/service context, workstreams, owners, dependencies and readiness criteria.
- **Outputs:** Versioned mobilisation plan/state; tasks/milestones; configuration/provisioning requests; readiness decision and handover evidence.
- **Responsibilities:** Coordinate workstreams; expose dependencies/risks; validate readiness; preserve decisions and ownership.
- **Boundary:** Mobilisation coordinates domain work but does not own site, workforce, equipment, brand or application records.

## Media Indexing

- **Owner:** Media domain; content owner TODO.
- **Inputs:** Asset/evidence reference; provenance, ownership, rights, classification and requested visibility.
- **Outputs:** Media record; validation/moderation status; searchable metadata; rendition/indexing intents.
- **Responsibilities:** Deduplicate; validate allowed metadata/content class; establish rights/retention; create authorised index entry.
- **Boundary:** Indexing does not imply public approval. Operational evidence may follow stricter policy than general brand media.

## Candidate future workflows

- Event capture and qualification
- Event amendment/cancellation
- Document generation and supersession
- Site/configuration publication
- Brand publication
- Permission assignment/review
- Delivery/logistics creation and completion
- Projection rebuild and reconciliation
- Legacy ingestion review
- Audit investigation/export under authority

These require domain discovery before specification.

## Common workflow result

Future workflows should return a consistent conceptual result containing:

- outcome: succeeded, rejected, conflict, needs review, partially completed or failed;
- authoritative record ID/version where created or changed;
- safe validation/error issues;
- accepted idempotency/source reference;
- effects requested and their independently traceable status;
- audit reference;
- recovery or next action.

This is a semantic expectation, not an API definition.

## Open questions

- TODO: Confirm business and operational owners for every workflow.
- TODO: Approve booking amendment/cancellation, pricing and downstream disposition policies.
- TODO: Define conceptual effect consistency, compensation and manual-recovery standards.
- TODO: Define workflow timeout, escalation and service expectations.
- TODO: Complete Equipment, Mobilisation, Media, Events and Logistics discovery.
