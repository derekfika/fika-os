# Stage 7 — Implementation

## Purpose

Build applications, domain services, repositories, adapters and workflows against approved schemas and architecture.

## Business outcome

FIKA receives usable platform capabilities that preserve canonical business meaning and reduce operational friction.

## Inputs

- Approved BDRs and schemas
- Reviewed platform architecture
- Engineering standards and application specifications
- Acceptance, migration and operational requirements

## Core activities

- Implement small, reviewable increments.
- Add tests, observability, permissions and recovery behaviour.
- Preserve legacy operation through explicit adapters where required.
- Measure performance and remove verified bottlenecks.
- Document configuration, deployment and rollback.

## Required artefacts

- Application and platform code
- Automated and manual test evidence
- Configuration and operational documentation
- Migration and rollback procedures
- Release records

## Exit criteria

- Implementation conforms to BDRs, schemas and architecture.
- Definition of Done is satisfied.
- Security, performance and failure behaviour are verified proportionately.
- Release and rollback authority are explicit.

## Current status

**Active — Increment 1 selected and chartered; implementation not yet started.** Derek subsequently selected Shadow CPU Production intake and reconciliation and supplied the accountable product, Production and delegated CPU-acceptance model required by the prior [selection review](stage-7-first-increment-selection-2026-07-27.md). The [activation record](stage-7-increment-1-activation-2026-07-27.md) and [Increment 1 charter](stage-7-increment-1-shadow-cpu-production-charter.md) activate Stage 7 only for that bounded read-only shadow outcome. Existing production applications continue operating and are not authorised for change.

The amended [before-first-code review](stage-7-increment-1-before-first-code-review-2026-07-27.md) returned **READY FOR FIRST CODE**. FIKA Xchange (`oploc:fika-xchange`) is the host Site Operational Location and CPUX (`oploc:cpux`) is the separate pilot producing Operational Location. Hosting belongs to a future separate governed Operational Location Relationship contract; a versioned non-canonical test assertion is permitted only for the isolated offline first seam. Implementation is authorised only for the single bounded task stated in that review.

Implementation commit `f18574c003c228a5d8d804e7467b79d94103bd8d` completed the first build, but the independent [technical completion review](stage-7-increment-1-technical-completion-review-2026-07-27.md) returned **NOT TECHNICALLY COMPLETE — OFFLINE SEAM**. The package satisfies its core business/evidence boundary and deterministic replay requirements, but a junction can redirect output beyond the declared directory and malformed JSON does not produce quarantine evidence. A package-only corrective task is required before technical completion; no live-source or Stage 8 work is authorised.

The review also records the corrected target architecture: upstream FIKA OS dashboards will originate governed Production JSON for CPU Dashboard ingestion, while Calendar remains a legacy compatibility and shadow-observation source during transition. The current `fika.cpu-intake-snapshot` contract is transitional and non-canonical; governance of the dashboard-to-CPU contract and source-neutral comparison boundary must precede any Calendar-provider extraction task.

The subsequent [dashboard-to-CPU contract boundary review](stage-7-dashboard-to-cpu-contract-boundary-review-2026-07-27.md) returned **DASHBOARD-TO-CPU CONTRACT BOUNDARY READY**. Dashboard-originated JSON is an idempotent Booking-to-Production Command, not a dashboard-created canonical Production Order. Production owns transformation and canonical identity; the CPU Dashboard consumes a Production-owned ingestion projection; Calendar remains a transitional observation source. This governance verdict does not change the offline seam's blocking technical defects or authorise implementation/live integration.

## Dependencies on earlier stages

- Stages 1–6

## Outputs consumed by later stages

Stage 8 validates and rolls out completed increments. Stage 9 uses operational evidence to propose governed change.

## Out of scope

- Unreviewed schema or architecture changes
- Silent production deployment
- Broad rewrites without evidence and rollback
- Treating current provider models as canonical business meaning

## Authoritative documents

- [Engineering standards](../engineering/repository-standards.md)
- [Definition of Done](../engineering/definition-of-done.md)
- [Testing strategy](../engineering/testing-strategy.md)
- [AI development playbook](../engineering/ai-development-playbook.md)
