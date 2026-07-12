# Stage 1 Review

> **Classification: Historical completion record.** This review closed the original platform-foundations work. Statements about then-unresolved business discovery are retained as historical context and are superseded by the completed [Stage 3 Business Discovery](stages/stage-3-business-discovery.md) and its 54 canonical decisions.

## Review status

Stage 1 has established a credible architectural foundation and is ready to close as a discovery/documentation stage, subject to recording the remaining unknowns as Stage 2 inputs rather than treating them as resolved facts.

This conclusion does not approve production refactoring, schema adoption, storage selection, deployment change, or application consolidation.

## What Stage 1 established

- A central architecture repository with working instructions, scope boundaries, roadmap context, stable platform principles, and decision records.
- A confirmed in-scope platform boundary and explicit exclusion of Bloom, HomeBuck, personal projects, and unrelated experiments.
- An application inventory covering current variants, shared utilities, planned capabilities, archive candidates, and manual-review items without exposing private identifiers.
- Data-source, integration, shared-function, and performance-risk inventories grounded in repository evidence.
- Detailed audits of the Hospitality Dashboard family, Hospitality Booking Platform family, and CPU Production Dashboard.
- MNK as the preferred direct-booking baseline; Angel Court's legacy inbox route as a retained adapter; CFC as Development; Demo as demonstration-only; The Line as non-baseline hospitality work.
- The Hospitality Booking Platform as the authoritative source of hospitality bookings.
- A target flow from canonical booking through Hospitality, CPU, and future Logistics.
- A draft `FikaBooking` domain model, supporting schemas and fixtures, explicitly not yet adopted.
- Separation of commercial booking status, dashboard workflow status, production state, integration metadata, and operational projections.
- ADR-003 for canonical booking/ingestion adapters and ADR-004 for the booking-to-production boundary.
- A technology-neutral current-system map and target architecture with repository abstraction and storage independence.
- Evidence-based Stage 2 priorities and a horizon view of future platform domains.

## Remaining unknowns

### Business and ownership

- application owners, users, lifecycle, criticality, health, volumes and service expectations for many current projects;
- Events business owner, first operational users, minimum workflows, status model, channels, and reporting needs;
- CPU production eligibility, time semantics, units/yields, dietary allocation, amendment/cancellation, and correction ownership;
- Logistics ownership and current end-to-end manual process;
- Workforce platform maturity, employee-data authority, privacy and operational use;
- catalogue/configuration ownership and approval processes;
- metric owners and definitions for cross-company reporting.

### Technical and operational

- authoritative booking storage and versioned delivery/mutation mechanism;
- permission/authentication model and role definitions;
- retention, backup, recovery, reconciliation, observability, release, and rollback requirements;
- measured application performance, quotas, failure rates, dataset sizes and concurrency;
- archive retention decisions;
- current till-provider workflows and migration requirements;
- detailed local MCP inventory and governance.

## Remaining documentation gaps

- repository/contribution/testing/release standards for Stage 2;
- glossary and approved status/identity vocabulary across domains;
- formal schema review/adoption lifecycle;
- configuration ownership, safe/private classification and change lifecycle;
- permissions, security, privacy, retention, recovery and audit policies;
- measurement plan with baselines and performance targets;
- Events channel/workflow discovery report;
- Logistics and Workforce focused inventories;
- application ownership/lifecycle register and archive retention register;
- projection reconciliation and legacy-adapter retirement criteria.

## Architectural risks

1. **Premature consolidation:** Similar code contains genuine site and workflow differences. Consolidating before contracts and fixtures could break live operations.
2. **Projection becoming authority:** Dashboard/CPU Sheets, Calendar events, quotes, or reports could silently compete with canonical records.
3. **Schema overreach:** Adding parser, provider, or CPU workflow fields to `FikaBooking` would weaken domain boundaries.
4. **Unresolved amendment semantics:** Optimistic concurrency alone does not decide how late booking changes affect prepared production work.
5. **Identity and duplicate effects:** Current Calendar/source and Sheet-scan duplicate controls do not yet provide end-to-end idempotency.
6. **Legacy dependency:** Email, spreadsheet, document, and Calendar adapters remain operationally important and require safe parallel migration.
7. **Unmeasured performance:** Code patterns indicate risk, but prioritising optimisation without timings and volumes may misdirect work.
8. **Security and privacy gaps:** Permissions, secrets, employee data, retention, evidence photographs and audit responsibilities need explicit policy.
9. **Storage coupling:** Current domain meaning is frequently reconstructed from rows, files, folders and provider metadata.
10. **Future-domain leakage:** Events, Production, Logistics, Equipment, Workforce and Reporting concepts could be conflated without ownership-led discovery.

## Is Stage 1 ready to close?

Yes, as an evidence and architecture-foundation stage. Its required purpose has been achieved: scope and current applications are visible, major shared boundaries and risks are documented, initial booking modelling has been tested downstream, and Stage 2 has prioritised inputs.

Closure should mean “foundation accepted for further discovery,” not “all facts known.” Unknown business facts remain TODOs and must be resolved before relevant schemas or workflows are adopted.

## Recommended first Stage 2 deliverables

1. Repository and contribution standards: document lifecycle/status, review gates, validation commands, naming, testing, release safety, and decision process.
2. A formal `FikaBooking` draft review resolving service-time semantics, ordered units, dietary-to-item mapping, status ownership, and mutation/delivery expectations.
3. Provisional `FikaProductionOrder` and `FikaProductionLine` domain documents/schemas with unresolved rules explicitly marked.
4. Events discovery: channels, users, owner, workflow/status, duplicate handling, source references, permissions, reporting, and first `FikaEvent` vocabulary.
5. `FikaSite`/`FikaAppConfig` discovery covering configuration ownership, safe/private separation, catalogues, capabilities and versioning.
6. A performance measurement plan and baseline for Dashboard load/settings, Gmail/form ingestion, CPU scanning/upsert, and booking submission persistence.
7. Security/permissions/retention/recovery requirements sufficient to constrain repository and integration design.

## Stage 1 closure conditions retained for Stage 2

- No draft schema becomes adopted without explicit review and decision.
- No production application is consolidated solely because files are similar.
- No legacy adapter is retired without usage, parity, reconciliation, rollback, and retention evidence.
- No storage technology is selected before repository needs, operational constraints, and migration cost are understood.
