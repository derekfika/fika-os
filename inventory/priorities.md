# Stage 1 Priorities

> **Classification: Historical planning evidence.** These priorities reflect the original Stage 1 evidence base. The canonical [nine-stage roadmap](../roadmap.md) now places Business Decision Records next.

## Method

Priorities are evidence-based recommendations, not commitments. Numeric scoring has not been used because user counts, business criticality, measured performance, ownership, and effort remain unconfirmed for many applications. Priority bands reflect confirmed architectural leverage, dependency order, duplication, and operational risk from the Stage 1 audits.

`P1` means establish first or investigate immediately. `P2` means follow once P1 contracts and measurements exist. `P3` means retain visibility and defer implementation pending further evidence.

## Applications

| Priority | Application/family | Recommendation | Evidence and dependency |
|---|---|---|---|
| P1 | Events Dashboard | Begin Stage 2 discovery and repository standards around this confirmed business priority; do not start implementation without event/channel inventory and schema work | Planned company-wide internal source of truth; The Line development is explicitly secondary to Events |
| P1 | Hospitality Booking Platform family | Treat MNK as the reference implementation and Angel Court legacy intake as a required adapter; define one shared product boundary before code consolidation | MNK live/direct baseline; Angel Court live; substantial shared code; booking is authoritative |
| P1 | Hospitality Dashboard family | Standardise consumer/projection boundaries around the canonical booking contract while preserving genuine site rules | Five variants, high duplication, current mixed workflow/projection responsibilities |
| P1 | CPU Production Dashboard | Define the production-order boundary and measure ingestion/projection behaviour before changing current adapters | Downstream test validates booking model but exposes missing production concepts and cancellation/amendment decisions |
| P2 | Workforce Operations Platform | Perform focused manual/technical inventory before confirming platform investment | Provisionally in scope; lifecycle/maturity and BrightHR authority remain unclear |
| P2 | Feedback collection/reporting | Review as a shared hospitality reporting family after booking/dashboard contracts stabilise | Confirmed shared utilities and exact shared dashboard modules |
| P2 | Munich RE hot-drinks tools | Retain as live client-specific reporting; investigate consolidation only if operational value is confirmed | Live and in scope; client-specific relationship confirmed |
| P3 | Logistics Dashboard | Conduct domain discovery after production-order direction is drafted | Planned capability with no repository; depends on Production and event/delivery semantics |
| P3 | Till-provider abstraction | Inventory current provider workflows and migration requirements before architecture | Planned capability; implementation and provider authority evidence incomplete |
| P3 | Demo applications | Keep for demonstrations; prevent demo behaviour from establishing production rules | Confirmed sales/tender purpose |

Lifecycle, users, ownership, criticality, current health, and production volumes remain TODO for applications not already confirmed.

## Shared workflows

| Priority | Workflow | Recommendation |
|---|---|---|
| P1 | Canonical booking ingestion | Versioned, idempotent direct submission plus legacy adapters producing the same contract |
| P1 | Server-authoritative validation and pricing | Share item resolution, choices, pricing snapshots, charges, acknowledgement, and validation boundaries; keep catalogue/site policy configurable |
| P1 | Booking-to-dashboard projection | Replace variant-shaped direct writes with a versioned consumer/projection contract; keep Sheets non-authoritative |
| P1 | Booking-to-production transformation | Define eligibility, source version, production IDs/lines, timing, units, amendments, cancellations, and dietary mapping |
| P1 | Identity, concurrency and audit | Stable IDs, idempotency keys/source references, optimistic concurrency, immutable processing evidence and duplicate-safe effects |
| P2 | Quote/PDF generation | Separate shared document utilities from pricing, template, folder, and print policy |
| P2 | Calendar projection | Standardise event construction/attachment behaviour behind an adapter after booking status/timing ownership is confirmed |
| P2 | Notifications | Share safe rendering/delivery orchestration with site/channel policy and duplicate prevention |
| P2 | Configuration resolution | Define safe/private, versioned site/application/workflow configuration before consolidating variants |
| P3 | Legacy Gmail/form parsing | Preserve and fixture-test adapters; do not expand them to new sites by default |

## Performance investigations

| Priority | Investigation | Required evidence |
|---|---|---|
| P1 | Hospitality Dashboard initial load and settings access | Rows, payload size, settings reads, cache behaviour, first/repeat load timings and user impact |
| P1 | Gmail/form ingestion | Search scope, messages/attachments, conversion/parser/write durations, quotas, failures and retry outcomes |
| P1 | CPU incremental/deep scanning and upsert | Events/pages, unchanged ratio, Drive conversions, Orders/Deliveries rows, calls, scan duration and partial failures |
| P1 | Booking submission persistence | Concurrent submissions, lock wait, complete-column duplicate scan, multi-Sheet partial state and recovery |
| P2 | Quote/PDF/Calendar workflows | Template/folder/file calls, document conversion, attachment refresh, total duration and failure stages |
| P2 | CPU dashboard rendering/cache | Payload, cache hit rate, visible items, aggregation render time and range invalidation |
| P2 | The Line revision matching | History size, scan/index cost, replacement accuracy and manual recovery |
| P2 | MNK recharge/bulk quote workflows | Rows/actions, service calls, formula scanning, partial writes and retry behaviour |

Optimisation should follow measurement. Large files and repeated calls are risk indicators, not measured incidents.

## Canonical schemas

| Priority | Schema/domain contract | Status and next action |
|---|---|---|
| P1 | `FikaBooking` family | Draft exists; resolve service-time/unit/dietary/status questions, review fixtures and decide adoption path |
| P1 | `FikaSite` and `FikaAppConfig` | Draft boundaries for site identity, safe/private configuration, catalogue/policy references and capabilities |
| P1 | `FikaProductionOrder` and `FikaProductionLine` | Enough evidence for provisional drafts; retain TODOs for eligibility, timing, units/yields, amendments and dietaries |
| P1 | `FikaEvent` | Begin discovery because Events Dashboard is a confirmed priority; do not infer hospitality booking equivalence |
| P2 | Quote/document metadata | Define after booking pricing/document ownership and retention are confirmed |
| P2 | Notification and audit/integration records | Define effect attempts, source references, retry/idempotency and immutable audit requirements |
| P2 | Logistics concepts | Discover after Production boundary and delivery semantics |
| P3 | Workforce concepts | Await focused Workforce/BrightHR audit and business ownership confirmation |

All schemas must remain draft until reviewed, versioned, documented with ownership/source-of-truth, and supported by fixtures and validation.

## Platform domains

| Priority | Domain | Rationale |
|---|---|---|
| P1 | Hospitality Booking | Confirmed authority and strongest cross-application contract |
| P1 | Hospitality Operations | Current shared dashboard family and immediate booking consumer |
| P1 | Production | Confirmed downstream dependency; separate domain boundary established by ADR-004 |
| P1 | Events | Confirmed company-wide priority and future internal authority |
| P2 | Configuration and Identity/Permissions | Cross-cutting prerequisites for shared products and tenants |
| P2 | Documents and Notifications | Repeated workflows with clear shared utilities but policy differences |
| P2 | Logistics | Confirmed future capability downstream of Production |
| P3 | Workforce Planning | Provisionally in scope pending review |
| P3 | Media, Equipment, Mobilisation and Executive Reporting | Future-domain considerations; business ownership and maturity TODO |

## Recommended Stage 2 sequence

1. Establish repository and contribution standards, document status vocabulary, decision lifecycle, validation commands, and non-production review gates.
2. Resolve the highest-impact `FikaBooking` questions and conduct a formal draft review without changing production consumers.
3. Draft provisional `FikaProductionOrder`/`FikaProductionLine` and transformation semantics.
4. Run Events discovery and channel inventory, then draft `FikaEvent` only from confirmed facts.
5. Define `FikaSite`/`FikaAppConfig` boundaries and configuration ownership.
6. Create a measurement plan and baseline the four P1 performance investigations.

## Business inputs required before reprioritisation

- application owners, users, lifecycle, criticality, health and volumes;
- Events business owner, first users, minimum workflows and source channels;
- Production status/timing/unit/amendment rules;
- Logistics ownership and current manual workflow;
- acceptable performance targets and operational failure tolerances;
- security, permission, retention, recovery and audit requirements;
- capacity and timing for Stage 2 deliverables.
