# FIKA Core Service Catalogue

## Status and conventions

These are candidate conceptual services, not deployed components or generated APIs. Candidate operations describe future business capabilities only; they do not prescribe endpoints, protocols, signatures or process boundaries. Several services may initially coexist within one application, provided their ownership and contracts remain separate.

## Booking Service

- **Purpose:** Own authoritative hospitality booking commercial and service intent.
- **Responsibilities:** Create, retrieve and govern booking versions; apply status rules; coordinate server-authoritative validation/pricing; preserve source provenance; enforce idempotency/concurrency; initiate downstream effects.
- **Owns:** `FikaBooking` lifecycle and booking-specific invariants.
- **Does not own:** Dashboard workflow state, quote documents, Calendar sync, CPU preparation, production quantities, logistics or raw legacy sources.
- **Candidate operations:** submit booking; amend booking; acknowledge; confirm; decline; cancel; retrieve current/version history; evaluate transition.
- **Dependencies:** Site, Configuration, Validation, Permission, Quote/Pricing policy, Notification, Audit and repositories.

## Site Service

- **Purpose:** Provide authoritative site identity and site-level operational context.
- **Responsibilities:** Resolve stable sites; expose approved capabilities, locations and configuration references; manage site lifecycle subject to ownership.
- **Owns:** Future `FikaSite` identity and site relationships.
- **Does not own:** Brand definitions, application configuration, users, bookings or physical storage identifiers as domain meaning.
- **Candidate operations:** create/update site; resolve site; list authorised sites; resolve service location; evaluate enabled capability.
- **Dependencies:** Configuration, Brand, Permission and SiteRepository.

## Event Service

- **Purpose:** Own the company-wide Event record shared by distinct source channels.
- **Responsibilities:** Capture/normalise events; govern lifecycle, venue, schedule, ownership and source; coordinate event amendments and downstream requirements.
- **Owns:** The governed Event aggregate and event-specific invariants.
- **Does not own:** Public-channel presentation, hospitality booking semantics, labour/equipment inventory, logistics execution or Calendar provider state.
- **Candidate operations:** create event draft; qualify; amend; cancel; assign owner; add requirements; retrieve pipeline/view.
- **Dependencies:** Site, User, Permission, Configuration, Equipment, Media, Quote, Document, Notification and EventRepository.

## Production Service

- **Purpose:** Own production work derived from eligible commercial/service demand.
- **Responsibilities:** Create and version production orders/lines; apply production conversion rules; manage production status, notes, allocation and amendment/cancellation disposition.
- **Owns:** The governed Production Order and Production Line concepts and production workflow state.
- **Does not own:** Commercial booking status/pricing, raw Calendar/parser metadata, dashboard UI state or logistics execution.
- **Candidate operations:** create from booking; revise from booking version; cancel/dispose; assign production facility; mark production milestones; retrieve production plan.
- **Dependencies:** Booking, Site, Configuration, Validation, Permission, Notification, Audit and ProductionRepository.

## Equipment Service

- **Purpose:** Govern physical equipment requirements, availability, allocation, condition and lifecycle.
- **Responsibilities:** Maintain equipment identity/types; record requirements; reserve/allocate; record faults, maintenance, movements and returns.
- **Owns:** Future equipment records, allocations and condition state.
- **Does not own:** Commercial equipment charges, event/booking status, logistics routing or supplier finance.
- **Candidate operations:** register equipment; request/reserve/allocate; report fault; update condition; release/return; list availability.
- **Dependencies:** Site, Event, Production, Logistics boundary, Permission, Notification and EquipmentRepository.

## Media Service

- **Purpose:** Govern reusable media assets, renditions, rights, ownership and usage.
- **Responsibilities:** Register/index media; validate metadata; manage approval, visibility, renditions, references and retention classification.
- **Owns:** Future media asset records and usage relationships.
- **Does not own:** Brand policy, document content, operational evidence policy, or external file storage implementation.
- **Candidate operations:** register/index asset; approve; publish/unpublish; create rendition request; link usage; archive.
- **Dependencies:** Brand, Permission, Validation, Audit and MediaRepository.

## Configuration Service

- **Purpose:** Resolve authoritative, validated configuration across defined scopes.
- **Responsibilities:** Read effective configuration; validate changes; apply inheritance/overrides; separate safe/private values; version and audit changes.
- **Owns:** Configuration records, scope and resolution policy.
- **Does not own:** Secrets themselves, business records, brand assets or permission decisions.
- **Candidate operations:** get effective configuration; propose/validate/publish change; compare versions; list scope overrides; retire value.
- **Dependencies:** Site, Application identity, User context, Permission, Audit and ConfigurationRepository.

## Brand Service

- **Purpose:** Resolve coherent brand identity for an experience and context.
- **Responsibilities:** Manage brand definitions, tokens, typography, logos, approved assets, client/white-label relationships and governed overrides.
- **Owns:** Brand identity and inheritance policy.
- **Does not own:** Media binary storage, application layout, business rules, recipients, permissions or site operational configuration.
- **Candidate operations:** resolve effective brand; validate brand configuration; list approved assets; publish brand version; evaluate override.
- **Dependencies:** Media, Configuration, Site, Permission and BrandRepository.

## Document Service

- **Purpose:** Govern document generation requests, artefact identity, templates, versions and retention references.
- **Responsibilities:** Create reproducible document artefacts from approved snapshots; track version/status; prevent duplicates; expose authorised references.
- **Owns:** Document records and generation lifecycle.
- **Does not own:** Booking/event pricing policy, file storage implementation, notification delivery or Calendar projection.
- **Candidate operations:** request generation; regenerate new version; retrieve metadata; supersede; archive; verify artefact.
- **Dependencies:** Brand, Media, Configuration, Permission, Validation and DocumentRepository.

## Quote Service

- **Purpose:** Own commercial quote intent, lifecycle and relationship to a source booking/event version.
- **Responsibilities:** Create/version quotes; apply approved pricing inputs; track commercial status; request document generation; preserve source traceability.
- **Owns:** Future quote aggregate and quote-specific lifecycle.
- **Does not own:** Booking aggregate, generated file storage, delivery of notifications or dashboard print state.
- **Candidate operations:** create quote; revise; issue; accept/decline/expire; retrieve; request document.
- **Dependencies:** Booking/Event, Validation, Permission, Document, Notification, Audit and QuoteRepository.

## Calendar Service

- **Purpose:** Project approved domain schedules to external calendar representations and reconcile them.
- **Responsibilities:** Build calendar intent; create/update/remove projections; prevent duplicates; retain provider references; report sync state and conflicts.
- **Owns:** Calendar projection/synchronisation records.
- **Does not own:** Booking/event/production status, canonical service timing or provider-specific details outside its adapter.
- **Candidate operations:** synchronise schedule; refresh; remove projection; reconcile; retrieve sync status.
- **Dependencies:** Booking, Event, Production, Permission, Configuration, Audit and Calendar projection repository/adapter.

## Notification Service

- **Purpose:** Turn authorised domain notification intent into governed delivery requests and outcomes.
- **Responsibilities:** Apply notification policy; render channel-neutral content; deduplicate; schedule; route; track delivery attempts and preferences.
- **Owns:** Notification intents and delivery lifecycle records.
- **Does not own:** Source domain state, recipient master identity, channel provider implementation or business decisions that trigger intent.
- **Candidate operations:** create intent; preview; dispatch; retry; cancel; retrieve status; record preference/suppression result.
- **Dependencies:** User/Contact, Brand, Configuration, Permission, Document, Validation, Audit and NotificationRepository/adapters.

## User Service

- **Purpose:** Represent platform actors and their stable organisational context.
- **Responsibilities:** Resolve actor identity, profile/reference, active state and memberships needed by other services.
- **Owns:** Future platform user/actor record, subject to privacy decisions.
- **Does not own:** Authentication mechanism, permission policy, workforce employment record or contact/customer aggregate.
- **Candidate operations:** resolve user; list memberships; update profile; activate/deactivate; link external identity reference.
- **Dependencies:** Permission, Configuration, Audit and UserRepository.

## Permission Service

- **Purpose:** Decide whether an actor may perform an action on a scoped resource.
- **Responsibilities:** Evaluate roles, grants, scopes, conditions and explicit restrictions; return explainable decisions; support audit.
- **Owns:** Permission policy and assignments, not authentication credentials.
- **Does not own:** User profile, domain records, UI visibility as enforcement, or provider access configuration.
- **Candidate operations:** authorise action; explain decision; list effective permissions; assign/revoke role; validate policy.
- **Dependencies:** User, Site, Configuration, Audit and PermissionRepository.

## Validation Service

- **Purpose:** Provide consistent structural and shared validation orchestration while preserving domain ownership of business rules.
- **Responsibilities:** Run schema, business, workflow, permission and external-input validation; produce structured issues; identify rule/policy versions.
- **Owns:** Validation result conventions and shared validation registry/process.
- **Does not own:** Domain policy decisions, source records, UI-only validation or integration retries.
- **Candidate operations:** validate command/record; validate transition; revalidate against policy; explain issue; retrieve rule version.
- **Dependencies:** Schemas, domain services, Configuration and Permission.

## Audit Service

- **Purpose:** Preserve attributable, immutable evidence of important domain, configuration, permission and integration actions.
- **Responsibilities:** Record events/attempts; link actor, record/version, action and outcome; support authorised investigation and retention policy.
- **Owns:** Audit event records and integrity expectations.
- **Does not own:** Current domain state, raw sensitive payloads, operational logs or reporting definitions.
- **Candidate operations:** append audit event; retrieve authorised history; verify chain/completeness; apply approved retention/redaction treatment.
- **Dependencies:** User, Permission, Configuration and AuditRepository.

## Candidate-service decisions

- TODO: Confirm service owners and whether Quote/Document, User/Permission, or Validation/Audit remain separate conceptual services.
- TODO: Complete Equipment, Media and Logistics domain discovery before adopting their operations; reconcile Event and Production operations with Packs 5 and 6.
- TODO: Define compatibility and deprecation rules for service contracts.
- TODO: Confirm which services belong in initial Core and which remain domain-local.
