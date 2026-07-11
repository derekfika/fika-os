# FIKA Core Repository Catalogue

## Purpose and rules

Repositories are conceptual interfaces between domain services and persistence. They describe required responsibilities, consistency and query boundaries without selecting storage, runtime, protocol or provider.

Repository interfaces should:

- use domain identities and versions rather than rows, paths or provider IDs;
- support optimistic concurrency and idempotent creation where relevant;
- distinguish canonical records, projections, configuration, files, checkpoints and audit history;
- enforce authorised access through service/workflow boundaries;
- state not-found, conflict and partial-failure outcomes;
- support migration/reconciliation without changing domain meaning;
- avoid business policy beyond persistence invariants.

## BookingRepository

- **Responsibility:** Persist and retrieve canonical booking aggregates and immutable historical versions.
- **Required capabilities:** Create idempotently; get current/specific version; conditionally update by expected version; query authorised booking references; preserve source-reference uniqueness; expose history linkage.
- **Does not own:** Status-transition policy, pricing, dashboard projections or raw legacy sources.

## SiteRepository

- **Responsibility:** Persist stable site records, lifecycle and authorised site relationships.
- **Required capabilities:** Get/list sites by stable identity and authorised scope; conditionally update; resolve aliases without making them identity.
- **Does not own:** Effective configuration resolution, brand inheritance or provider configuration.

## EventRepository

- **Responsibility:** Persist future canonical event aggregates and versions.
- **Required capabilities:** Idempotent creation from channels; versioned mutation; retrieve pipeline/query views; preserve source references and lifecycle history linkage.
- **Does not own:** Public experience state, Calendar projections, equipment allocations or logistics jobs.

## ProductionRepository

- **Responsibility:** Persist future production orders/lines and their source booking/event version links.
- **Required capabilities:** Idempotent creation; versioned amendments; status/progress mutation; query production plans; retain cancellation/amendment disposition.
- **Does not own:** Booking pricing/status, CPU UI filters or raw parser data.

## EquipmentRepository

- **Responsibility:** Persist equipment identity, type, condition, allocation and maintenance state.
- **Required capabilities:** Retrieve availability; reserve/release with conflict protection; record movements/faults/maintenance; query by site/status.
- **Does not own:** Commercial equipment charges or logistics routing.

## MediaRepository

- **Responsibility:** Persist media metadata, versions/renditions, ownership, rights, visibility and usage references.
- **Required capabilities:** Register metadata; version/update; search authorised metadata; link usage; apply lifecycle/retention state.
- **Does not own:** Binary implementation, brand policy or operational evidence decisions.

## ConfigurationRepository

- **Responsibility:** Persist versioned configuration values by scope with ownership, validity and audit linkage.
- **Required capabilities:** Get scope/version; publish conditional change; list overrides; retrieve effective-input set; retain history.
- **Does not own:** Inheritance policy, secret values, business records or permission decisions.

## BrandRepository

- **Responsibility:** Persist versioned brand definitions, token sets, asset references and approved override relationships.
- **Required capabilities:** Retrieve brand/version; publish conditional update; list hierarchy/overrides; retain prior versions.
- **Does not own:** Media content storage, application layout or business configuration.

## DocumentRepository

- **Responsibility:** Persist document metadata, source-record/version relationships, generation state, artefact references and supersession history.
- **Required capabilities:** Idempotent generation record; get version/status; record success/failure; supersede/archive; list authorised documents.
- **Does not own:** Domain pricing, template business policy or physical file implementation.

## QuoteRepository

- **Responsibility:** Persist future quote aggregates, versions, status and source relationships.
- **Required capabilities:** Create/version conditionally; retrieve current/history; query by source/customer/status; link document versions.
- **Does not own:** Booking state, generated artefact content or delivery attempts.

## UserRepository

- **Responsibility:** Persist stable platform actor profiles, active state and organisational memberships.
- **Required capabilities:** Resolve stable actor/external reference; retrieve authorised profile; update conditionally; list memberships.
- **Does not own:** Credentials, authentication sessions, employee master data or permission policy.

## PermissionRepository

- **Responsibility:** Persist conceptual roles, grants, restrictions, scope assignments and policy versions.
- **Required capabilities:** Retrieve effective policy inputs; assign/revoke conditionally; list role definitions and scoped assignments; retain change history.
- **Does not own:** Authorisation evaluation, user identity or UI visibility.

## NotificationRepository

- **Responsibility:** Persist notification intents, deduplication keys, channel requests, attempts, outcomes and suppression/preference decisions.
- **Required capabilities:** Create idempotently; claim/record attempt; schedule/retry/cancel; query status; retain delivery evidence under policy.
- **Does not own:** Source domain state, recipient identity or channel transport.

## AuditRepository

- **Responsibility:** Append and retrieve immutable, attributable audit events under access and retention rules.
- **Required capabilities:** Append once; query by record/version/actor/action/time; verify integrity/completeness; apply approved redaction treatment without rewriting business history improperly.
- **Does not own:** Current state, debug logs or raw sensitive payloads.

## ProjectionRepository

- **Responsibility:** Maintain rebuildable operational/read projections linked to canonical record IDs and versions.
- **Required capabilities:** Upsert idempotently from source version; query view; record projection checkpoint/error; rebuild/reconcile; identify staleness.
- **Does not own:** Canonical business identity/status or direct authoritative mutation.

## IntegrationCheckpointRepository

- **Responsibility:** Persist adapter source references, idempotency/checkpoints, attempts, mapping diagnostics and reconciliation state.
- **Required capabilities:** Claim source idempotently; record attempt/outcome; resume/retry; query unresolved inputs; link canonical output.
- **Does not own:** Canonical domain facts or raw content beyond approved evidence references.

## Repository relationships

Services use canonical repositories to change domain state. Workflows request projections, documents, notifications and integrations after authoritative success. Audit and checkpoint records preserve traceability without being embedded into aggregates.

No application should bypass an authoritative service to mutate a canonical repository. Read models may be accessed through authorised query services where direct domain mutation is impossible.

## Open questions

- TODO: Decide aggregate history and audit-history relationship.
- TODO: Define cross-repository transaction, outbox/effect and compensation expectations conceptually.
- TODO: Confirm query/read-model ownership and acceptable consistency.
- TODO: Define retention, deletion, redaction, backup, restoration and reconciliation requirements per repository.
- TODO: Confirm repository contract versioning and migration compatibility rules.
