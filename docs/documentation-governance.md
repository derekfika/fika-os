# Documentation Governance

## Purpose

This document defines how knowledge is organised, trusted and changed in the FIKA OS specification repository. It prevents supporting evidence, historical plans, draft schemas and application behaviour from silently redefining approved business meaning.

## Authority order

When two documents differ, use the highest applicable source in this order:

1. **Approved canonical decisions** in the FIKA Business Knowledge Workbook
2. **Business Decision Records (BDRs)** that preserve and explain those decisions
3. **Canonical domain definitions and business journeys**
4. **Completed and integrated canonical schemas**
5. **Approved platform architecture**
6. **Application specifications**
7. **Supporting evidence**, including inventories, audits, discoveries and workshops
8. **Historical or superseded material**

Downstream documents must reference upstream authority and must not silently redefine it. Where an approved decision changes, create or supersede the relevant BDR before changing schemas, architecture or implementation.

The [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) is the approved source register. Stage 4 preserved all 54 canonical decisions as durable repository BDRs; their exact Decision sections govern downstream repository work.

## Document classifications

- **Canonical:** authoritative at its stated layer and status.
- **Supporting evidence:** retained facts, examples, audits or analysis that inform authority but cannot override it.
- **Historical:** records past work, reasoning or plans; useful for context but not current direction.
- **Superseded:** replaced by a named authoritative source.
- **Duplicate:** repeats another document without adding evidence; consolidate and retain only a pointer if history is useful.
- **Needs consolidation:** contains useful knowledge mixed with stale or repeated definitions and must be reconciled before being treated as current.

Draft, proposed and planned documents are never adopted authority merely because they exist in a canonical directory.

## Repository classification register

| Document or group | Classification | Authoritative purpose |
|---|---|---|
| `AGENTS.md` | Canonical | Repository working and safety instructions |
| `README.md` | Canonical | Primary navigation and current status |
| `roadmap.md` | Canonical | Nine-stage knowledge-to-delivery lifecycle and delivery themes |
| `docs/historical/legacy-19-stage-roadmap.md` | Historical | Complete former implementation roadmap retained as planning evidence |
| `stage1.md` | Historical | Original platform-foundations delivery plan; superseded for stage numbering |
| `docs/stages/*.md` | Canonical | Purpose, gates and status for the nine canonical stages |
| `docs/scope.md` | Canonical | Platform scope and exclusions |
| `docs/platform-principles.md` | Canonical | Enduring platform principles |
| `docs/platform-domain-map.md` | Canonical | Highest-level business-domain relationships and terminology |
| `docs/current-system-map.md` | Canonical current-state record | Evidence-backed classification of current systems, projections and adapters |
| `docs/target-architecture.md` | Accepted architecture | Technology-neutral Stage 6 boundary governed by accepted ADRs; not implementation or deployment authority |
| `docs/future-platform-domains.md` | Supporting | Long-term domain candidates, not commitments |
| `docs/stage-1-review.md` | Historical | Closure record for the original platform-foundations work |
| `docs/documentation-governance.md` | Canonical | Authority order and document classification |
| `docs/platform-methodology/business-discovery-process.md` | Canonical method | Governed discovery-to-delivery workflow |
| `docs/business-decisions/README.md` | Canonical index | BDR governance and future record index |
| `docs/business-decisions/000-template.md` | Canonical template | Required BDR structure |
| `docs/domain-discovery/*.md` | Supporting evidence | Domain hypotheses, evidence and questions that preceded canonical decisions |
| `docs/business-workshops/*.md` | Historical discovery evidence | Workshop questions and candidate models; superseded by approved decisions where different |
| `docs/business-journeys/new-site-mobilisation-journey.md` | Supporting evidence | Evidence-backed mobilisation journey pending BDR consolidation |
| `docs/domain-models/fika-booking-v1.md` | Supporting draft | Pre-Pack booking domain-model evidence for Stage 5 |
| `docs/schema-reviews/fika-booking-v1-review.md` | Supporting review | Formal review of the earlier supporting schema draft |
| `docs/decisions/ADR-003-canonical-booking-and-ingestion-adapters.md` | Supporting proposed ADR | Proposed technical/architectural direction; subject to BDR and schema reconciliation |
| `docs/decisions/ADR-004-booking-to-production-boundary.md` | Supporting accepted ADR | Architectural boundary evidence; business wording must align with BDRs |
| `docs/decisions/ADR-001-stage-6-platform-boundaries.md` | Accepted ADR | Initial Stage 6 responsibility model constrained by Packs 1–8 and approved business authority |
| `docs/decisions/ADR-005-domain-event-and-integration-contract.md` | Accepted ADR | Technology-neutral contract for domain facts, integration events, delivery, idempotency, ordering and replay |
| `docs/decisions/ADR-006-repository-and-consistency-contract.md` | Accepted ADR | Technology-neutral contract for repository ownership, canonical persistence, concurrency, cross-domain consistency and recovery |
| `docs/decisions/ADR-007-projection-and-dashboard-boundary.md` | Accepted ADR | Technology-neutral contract for projection ownership, freshness, rebuilding, reporting and dashboard boundaries |
| `docs/decisions/ADR-008-identity-and-authmod-enforcement-boundary.md` | Accepted ADR | Provider-neutral contract for authentication evidence, actor mapping, AUTHMOD evaluation and authoritative enforcement |
| `docs/decisions/ADR-009-booking-to-production-orchestration.md` | Accepted ADR | Technology-neutral contract for Booking-to-Production eligibility, lifecycle coordination, recovery and reconciliation |
| `docs/decisions/ADR-010-legacy-coexistence-and-retirement.md` | Accepted ADR | Technology-neutral contract for bounded coexistence, authority direction, readiness, cutover, fallback and retirement |
| `docs/decisions/ADR-011-notification-generation-and-delivery.md` | Accepted ADR | Technology-neutral contract for notification intent, recipient/content resolution, provider delivery, qualified outcomes and reconciliation |
| `docs/decisions/README.md` | Canonical ADR index | Architectural Decision Record guidance, distinct from BDRs |
| `docs/fika-core/*.md` | Supporting Stage 6 specification | Catalogues constrained by ADR-001, ADR-005 and later accepted ADRs; do not independently create business authority |
| `docs/engineering/*.md` | Canonical engineering standards | Delivery, testing, review and AI-working standards |
| `inventory/applications.md` | Supporting evidence | Application inventory |
| `inventory/data-sources.md` | Supporting evidence | Data-source inventory |
| `inventory/integrations.md` | Supporting evidence | Integration inventory |
| `inventory/shared-functions.md` | Supporting evidence | Shared-function and duplication inventory |
| `inventory/performance-issues.md` | Supporting evidence | Performance-risk inventory |
| `inventory/priorities.md` | Historical planning evidence | Stage 1 prioritisation before completed business discovery |
| `inventory/reports/*.md` | Supporting evidence | Read-only repository-family and business-domain audits |
| `schemas/README.md` | Canonical entry point | Status and navigation for future adopted schemas |
| `fixtures/README.md` | Canonical entry point | Rules for future non-production fixtures |
| `config-examples/README.md` | Canonical entry point | Rules for future safe configuration examples |

## Status banners

Supporting, historical and superseded documents should state their classification near the top and link to the higher authority that governs conflicts. A banner must not erase evidence or imply that the evidence was wrong; it clarifies its present role.

## Terminology

Use these terms consistently in current canonical documents:

- Operational Location (OPLOC)
- Client and Client Contact
- Operational Capability
- Service Arrangement, Recurring Schedule and Service Occurrence
- Booking, Event and Production Order
- Role, Responsibility, Assignment and Approval Authority
- View, Contribute, Manage, Approve, Publish and Administer

Historical source wording such as “site”, “venue” or generic “location” may remain when quoting or explaining evidence. Current prose must use the canonical term unless it deliberately means a different concept.

## Change rules

1. Identify the upstream authority before editing downstream material.
2. Preserve approved wording in BDRs; add explanation around it without paraphrasing the decision itself.
3. Link instead of copying long definitions.
4. Mark supersession explicitly and retain useful rationale and evidence.
5. Run link, terminology, status and contradiction checks before completion.
6. Never treat code, a provider object or spreadsheet layout as automatic business authority.

## See also

- [Business-discovery process](platform-methodology/business-discovery-process.md)
- [Canonical stages](stages/stage-1-vision.md)
- [Business Decision Records](business-decisions/README.md)
