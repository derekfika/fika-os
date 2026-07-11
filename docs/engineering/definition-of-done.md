# Definition of Done

## Purpose

A FIKA Platform capability is complete only when it is correct, understandable, secure, testable, operable, recoverable, and accepted for its intended scope. Code completion alone is not done.

Use this checklist for implementation, material configuration, schema, workflow, integration and UI changes. Mark non-applicable items with a reason. Approved exceptions require an owner and follow-up.

## Outcome and ownership

- [ ] The confirmed business outcome and acceptance criteria are met.
- [ ] Scope, users, owner and operational responsibility are documented or explicitly TODO before non-production discovery only.
- [ ] No unrelated capability or production behaviour was changed.
- [ ] Remaining limitations and decisions are visible and accepted by the appropriate owner.

## Architecture and domain

- [ ] The capability follows platform principles and the reviewed architecture.
- [ ] Domain ownership and source-of-truth are explicit.
- [ ] Canonical records, operational projections, caches, audit history and legacy adapters are distinguished.
- [ ] Public/client and internal operational concerns remain appropriately separated.
- [ ] A required ADR is accepted and linked; superseded decisions are recorded rather than overwritten.
- [ ] Storage/provider details have not leaked into domain meaning.

## Schemas and data

- [ ] Adopted schema versions are used correctly; drafts are labelled and not treated as adopted.
- [ ] Stable IDs, versions, timestamps, actors, statuses, money, units and time zones are unambiguous where applicable.
- [ ] Required/optional fields and validation are enforced at trust boundaries.
- [ ] Valid and invalid fixtures cover representative variants without private production data.
- [ ] Compatibility and migration for producers/consumers are documented.
- [ ] Personal/sensitive data is minimised and retention requirements are satisfied.

## Code and configuration

- [ ] Code follows repository and coding standards or documents an approved exception.
- [ ] Business logic, workflows, repositories, adapters and presentation have clear boundaries.
- [ ] Site/client variation is configuration where appropriate; genuine rule differences remain explicit.
- [ ] Safe/private configuration and secrets are separated and validated.
- [ ] No credentials, private identifiers, customer records, generated local state or debug artefacts were introduced.
- [ ] Unrelated user changes were preserved.

## Correctness and failure behaviour

- [ ] Input validation, permissions and output encoding are implemented at authoritative boundaries.
- [ ] Idempotency and duplicate effects are addressed for repeatable commands/integrations.
- [ ] Concurrency and stale versions are handled where records mutate.
- [ ] Error types, user recovery, retries, partial failure, cancellation and amendment behaviour are defined.
- [ ] Irreversible effects and manual recovery are documented.
- [ ] Audit records contain safe, attributable and useful context.

## Testing

- [ ] Required static, type, schema and structural checks pass.
- [ ] Unit tests cover changed domain rules and boundaries.
- [ ] Contract/schema tests and fixtures pass where applicable.
- [ ] Integration and workflow tests cover success, duplicate, failure and recovery paths proportionately.
- [ ] Regression tests protect fixed defects and affected variants.
- [ ] Manual testing is recorded for judgement-dependent behaviour.
- [ ] UI work is checked for accessibility, responsive behaviour and all material states.
- [ ] Smoke tests pass in the release context.
- [ ] Untested areas and residual risk are explicitly recorded.

## Performance and reliability

- [ ] A relevant baseline and acceptance target exist for performance-sensitive work.
- [ ] Measurements show the change meets the target without correctness loss.
- [ ] Operational limits, concurrency, payloads and dependency behaviour are understood proportionately.
- [ ] Health, logs, metrics and alert/support ownership are adequate for impact.
- [ ] Backup, restore, reconciliation, retry and recovery expectations are satisfied.

## Documentation and usability

- [ ] README, architecture, ADR, schema, runbook, inventory and changelog updates are complete where applicable.
- [ ] Documentation matches actual behaviour and does not expose secrets/private data.
- [ ] Setup, configuration, validation, release, rollback and recovery steps are reproducible.
- [ ] User terminology, status, ownership, next action and exceptions are clear.
- [ ] Loading, empty, validation, success, warning, error and permission-denied states are present where relevant.

## Review and release

- [ ] The actual diff was reviewed for correctness, security, accessibility, performance, migration and unintended files.
- [ ] Pull-request evidence lists checks and results accurately.
- [ ] Required human and architecture approvals are recorded.
- [ ] Release scope, version/reference, configuration, compatibility and dependencies are confirmed.
- [ ] Rollout, smoke verification, monitoring, rollback and communication plans are ready.
- [ ] Release result and any recovery action are recorded.

## Completion statement

The capability may be marked complete when all applicable items pass and approved exceptions are documented. If production authority, business ownership, recovery, security, or required validation is missing, the capability is not done; it may only be described as a draft, prototype, or investigation.

## Standards still requiring organisational decisions

- TODO: required reviewer count and code ownership;
- TODO: standard automated quality tools and minimum thresholds;
- TODO: supported environments and release approval authority;
- TODO: release versioning/tagging and change-record policy by repository type;
- TODO: accessibility conformance target;
- TODO: performance service targets;
- TODO: security review cadence and privacy/retention policy;
- TODO: incident, support and escalation ownership.
