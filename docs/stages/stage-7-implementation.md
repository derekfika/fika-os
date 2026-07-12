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

**Planned.** Existing production applications continue operating and are not authorised for change by this stage document.

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

