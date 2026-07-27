# Repository and Port Catalogue

## Status

Stage 6 supporting catalogue governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md) and [ADR-006](../decisions/ADR-006-repository-and-consistency-contract.md). It defines logical responsibilities only and selects no storage technology.

## Repository rules

- Repository contracts are owned by the domain responsible for the canonical records and invariants they protect.
- Boundaries follow governed consistency scopes, not a repository-per-schema or universal repository-per-domain rule.
- Contracts use canonical identifiers and records, not tables, files, provider payloads or UI rows.
- Domain services are the write boundary; applications do not write repositories directly.
- Repositories preserve comparison, history, provenance and uniqueness required by the governed domain; optimistic concurrency is the default expectation where concurrent change is possible.
- Cross-domain joins belong in orchestration or projections, not hidden inside a domain repository.
- A repository interface does not imply a separate database or deployment.

## Governed domain repositories

| Repository boundary | Canonical responsibility | Must not expose |
|---|---|---|
| ClientRepository | Client, Contact and governed relationship records | Operational Location internals or Booking data |
| OperationalLocationRepository | OPLOC identity, aliases, lifecycle and Location Type history | address/provider/application models |
| AuthorityRepository | Roles, responsibilities, assignments, grants, access boundaries and emergency access | authentication-provider objects or inferred authority |
| CapabilityRepository | Catalogue, dependency, enablement and override records | domain rules disguised as capability data |
| ConfigurationRepository | Effective-dated configuration and authorised variations | secrets or universal precedence assumptions |
| ServiceRepository | Services, Arrangements, Recurring Schedules and exceptions | Booking, Event or Production aggregates |
| BookingRepository | Booking aggregate and governed version/amendment history | parser internals, dashboard state or Production state |
| EventRepository | Event and auditable approval record | Calendar/provider event as authority |
| ProductionRepository | Orders, Lines, routing and change history | customer-facing Booking state |
| MobilisationRepository | Mobilisation programme, plan, tasks and readiness | routine operational task lists without mobilisation governance |
| BrandRepository | Brand Variations and Brand Assurance Records | media binaries or rendering implementation |
| WasteRepository | Waste Events and Dispositions | Improvement Actions or report projections |

The names are evidence-supported ownership-family labels, not prescribed code names, aggregate boundaries or a repository-per-schema catalogue. A domain may use more than one repository, and one repository may coordinate related records, only where governed invariants justify that consistency scope.

## Projection ports

Projection ports accept committed domain facts or retrieve rebuildable views for an identified consumer. Each projection specification must state:

- source canonical records and versions;
- consumer and purpose;
- refresh or lag expectation;
- rebuild and reconciliation method;
- sensitive-field restrictions;
- whether any user-entered operational state is separately authoritative.

Dashboard, reporting, Calendar, document and Sheet views are projection candidates. A projection is never the only durable audit history.

## Provider ports

Provider ports express the capability required by orchestration or a domain without importing provider concepts. Candidate port categories include notification delivery, document rendering, file storage, calendar delivery and external workforce access. Their existence does not establish a new business domain.

Provider adapters own translation, authentication to the provider, retries required by the provider contract and provider identifiers. They do not decide business eligibility or approval.

## Legacy adapter ports

Legacy ingestion and coexistence ports preserve stable source references, normalise input and expose reconciliation evidence. They must identify the authoritative direction and must not allow circular write-back to create competing truth.

Examples supported by current evidence include Angel Court email ingestion and Calendar-led CPU ingestion. Their continued use is transitional unless later evidence establishes a different classification.

## Integration checkpoint records

An integration checkpoint may record delivery attempts, consumer deduplication, provider references, quarantine/replay context and reconciliation status. It is integration processing metadata, not a domain aggregate or the ADR-005 event envelope. ADR-006 governs its separation from canonical state and its recovery purpose without selecting storage.

## Workflow-state repositories

Application orchestration may persist process step, correlation, retry, waiting, intervention, compensation and reconciliation state plus references to participating canonical records. This state does not transfer ownership and cannot be used to mutate another domain's repository directly.

## Candidate repositories

Equipment, Media, Workforce, Logistics, Reporting, Document, Notification and Quote repositories are not adopted by this catalogue. They require a governed domain boundary or a proven port responsibility first.

## Open questions

- Domain-specific merge, precedence and compensation policy where business authority is unresolved.
- Physical durable record/publication coordination technique.
- Projection rebuild and retention targets.
- Whether shared audit conventions require one logical AuditRepository.
