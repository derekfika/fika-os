# Stage 8 — Validation and Rollout

## Purpose

Prove that an implementation behaves correctly, protects data, supports operations and can be adopted safely.

## Business outcome

FIKA can rely on new capabilities without losing business continuity, auditability or a credible recovery path.

## Inputs

- Implemented capability and release candidate
- Approved BDRs, schemas and architecture
- Acceptance criteria, test plans and operational readiness evidence

## Core activities

- Validate business behaviour and data integrity.
- Test permissions, security, accessibility, performance and recovery.
- Conduct smoke, regression and user acceptance testing.
- Rehearse migration and rollback.
- Roll out in controlled phases and monitor outcomes.

## Required artefacts

- Validation report
- Test and acceptance evidence
- Operational-readiness assessment
- Rollout, monitoring and rollback plan
- Release approval

## Exit criteria

- Business owners accept the behaviour.
- Required tests pass or accepted exceptions are documented.
- Data migration and reconciliation are verified.
- Support, monitoring and rollback are ready.
- Production release is explicitly authorised.

## Current status

**Planned.** No rollout is authorised by the documentation refactor.

## Dependencies on earlier stages

- Stages 1–7

## Outputs consumed by later stages

Stage 9 uses rollout results, operational feedback and measured outcomes as new evidence.

## Out of scope

- Inventing acceptance criteria after release
- Unauthorised deployment
- Treating partial testing as business acceptance
- Removing legacy support before transition evidence supports it

## Authoritative documents

- [Testing strategy](../engineering/testing-strategy.md)
- [Definition of Done](../engineering/definition-of-done.md)
- [Branching and release standards](../engineering/branching-and-release.md)

