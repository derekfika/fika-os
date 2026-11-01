# 2026-11-01 — Outbound environment gate (issue #181, slice A)

Adds `packages/server-shared/src/outbound-environment.ts`, a pure, fail-closed decision helper for
email and Drive PDF routing: production passes through, staging resolves a single verified owner
inbox plus isolated Drive root/destinations, local is blocked, and every mode/project/identity/config
inconsistency returns a retryable `OutboundGateError` with no side effects. `applyStagingMailRouting`
replaces To/CC/BCC with the owner inbox in staging (originals kept only as a count). It is a decision
helper only: no consumer is wired, no default inbox/folder IDs ship, and DWD scopes/IAM isolation must
be verified separately by the owner/admin. No `package.json` export entry yet; it is added with the
first consumer slice (tests import by relative path).

Validation: `packages/server-shared/tests/outbound-environment.test.ts` (node:test via tsx) and tsc typecheck.
Deployment: none.
