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

**Active — implementation increments are underway.** The original bounded Shadow CPU Production increment remains governed by its activation and charter records, while the current repository also contains authorised UAT implementation work across the hospitality booking, CPU production and logistics applications. The latest increment connects booking review, quoting, allergen readiness, menu generation, CPU handoff, driver dispatch and van-based logistics planning.

The amended [before-first-code review](stage-7-increment-1-before-first-code-review-2026-07-27.md) returned **READY FOR FIRST CODE**. FIKA Xchange (`oploc:fika-xchange`) is the host Site Operational Location and CPUX (`oploc:cpux`) is the separate pilot producing Operational Location. Hosting belongs to a future separate governed Operational Location Relationship contract; a versioned non-canonical test assertion is permitted only for the isolated offline first seam. Further UAT increments are recorded in the repository changelog and remain subject to the Stage 8 validation and rollout gate.

Implementation commit `f18574c003c228a5d8d804e7467b79d94103bd8d` completed the first build, but the independent [technical completion review](stage-7-increment-1-technical-completion-review-2026-07-27.md) returned **NOT TECHNICALLY COMPLETE — OFFLINE SEAM**. The package satisfies its core business/evidence boundary and deterministic replay requirements, but a junction can redirect output beyond the declared directory and malformed JSON does not produce quarantine evidence. That review’s package-only corrective task remains a historical condition of the original shadow seam; the current hospitality/CPU/logistics UAT work is separately recorded and proceeds through the Stage 8 validation gate.

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
