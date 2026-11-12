# 2026-11-12 — Prevent Calendar outbox starvation

The Hospitality Calendar worker and its read-only scheduler preview now filter to pending and retryable failed obligations before the three-record batch limit. Delivered and dead-lettered records cannot occupy the worker selection window. Transactional lease, due-state, retry, idempotency and source-version checks remain in place. Added the matching Firestore composite index.

Validation: focused outbox query/inventory tests (6 passed), Hub typecheck, changed-file ESLint and production build passed. Full Hub test run: 1,172 tests, 1,049 passed, 122 skipped, one unrelated missing `fika-platform-specs` submodule document failure. Staging/CI status pending.
Deployment: none.
