# Testing Strategy

## Purpose

Testing provides evidence that a change satisfies confirmed requirements, preserves important existing behaviour, and fails safely. The required depth is proportional to business impact, data mutation, permissions, integration effects, and recovery difficulty.

## Test layers

### Static and structural checks

- formatting, linting and type checks where configured;
- schema syntax and reference resolution;
- secret/private-data detection;
- documentation links and required files;
- dependency and generated-file consistency.

TODO: Select standard tools and minimum enforced checks.

### Unit tests

Use for pure validation, pricing, status transitions, mapping, identifiers, time/money calculations, aggregation, permission decisions, and error classification. Cover normal, boundary, invalid, duplicate, stale-version, and variant-specific cases.

### Contract and schema tests

- Validate every canonical fixture against its declared schema version.
- Include representative valid fixtures and deliberately invalid cases.
- Test required/optional fields, enums, formats, money units, timestamps, stable IDs and additional-property policy.
- Test backward/forward compatibility according to the contract's adoption policy.
- Test adapters against the canonical output contract without making legacy layouts canonical.
- A draft schema is not adopted merely because it validates.

### Integration tests

Test repository interfaces, adapters, notifications, file/document operations, and external dependencies through controlled non-production boundaries. Verify retries, idempotency, permission failures, missing input, partial success, rate/availability failure, and reconciliation.

Never use private production records as fixtures.

### Workflow tests

Test end-to-end domain outcomes across commands, authoritative records, effects, projections, audit, and failure recovery. Include repeated commands, stale versions, cancellations, amendments, and partial processing where applicable.

### UI tests

Test supported viewport sizes, keyboard-only operation, focus, accessible names, validation, loading, empty, error, success, permission-denied, long-content, and slow/failing dependency states. Confirm public and internal experiences show consistent underlying facts without exposing restricted data.

## Manual testing

Manual testing is required when judgement, visual quality, operational workflow, accessibility, or integration behaviour cannot yet be covered reliably by automation.

A manual test record should state:

- build/change reference;
- environment and safe test data;
- preconditions;
- steps and expected outcomes;
- actual result;
- tester and date;
- evidence without secrets/private data;
- defects, limitations and follow-up.

Manual success does not replace repeatable regression coverage for stable, high-value behaviour.

## Regression testing

- Every defect fix should add or update a regression test where practical.
- Preserve fixtures for confirmed source variants and genuine business-rule differences.
- Run affected-family tests when shared packages, schemas, workflows or adapters change.
- Test operational state preservation when rebuilding projections.
- Before consolidating variants, prove configuration-only differences and preserve genuine rules with tests.
- Maintain a small critical regression suite that can run before every release.

## Smoke testing

Smoke tests verify that a released capability starts, accepts authorised access, loads its primary view, reads required configuration, performs one safe core path, handles one known failure, and exposes expected health/diagnostic signals.

Smoke tests must avoid irreversible effects. If a test creates records, files, events, or notifications, use isolated data and documented cleanup.

## Performance testing

Measure before optimising. Record dataset size, concurrency, environment, first/repeat timings, calls/effects, payload size, failure rate, and user impact. Preserve a baseline and acceptance threshold for material workflows.

Performance tests must also verify correctness, consistency, and recovery; speed must not hide lost or duplicated work.

## Security testing

Test permissions at authoritative boundaries, input validation, output escaping, secret exclusion, sensitive-data minimisation, audit attribution, duplicate protection, and safe failure. Include unauthorised, cross-site/client, stale-session, malformed-input, and excessive-input cases where relevant.

TODO: Define formal security review frequency and independent testing expectations.

## Future automated testing

Automation should grow in this order:

1. schema/fixture validation and pure domain rules;
2. critical adapter and repository contracts;
3. high-value workflow regressions;
4. accessible UI component and journey tests;
5. release smoke and compatibility tests;
6. controlled performance and resilience tests.

Tests must remain deterministic, isolated, readable, and maintainable. Flaky tests are defects; quarantine requires an owner and repair date.

## Test completion record

Every pull request and release records which checks ran, their outcomes, what was not tested, why, and the resulting risk. “Not applicable” requires a reason.
