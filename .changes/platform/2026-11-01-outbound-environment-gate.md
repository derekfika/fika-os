# 2026-11-01 — Outbound environment gate (issue #181, slice A)

Adds `packages/server-shared/src/outbound-environment.ts`, a pure, fail-closed decision helper for
email and Drive PDF routing: production passes through, staging resolves a single verified owner
inbox plus isolated Drive root/destinations, local is blocked, and every mode/project/identity/config
inconsistency returns a retryable `OutboundGateError` with no side effects. `applyStagingMailRouting`
replaces To/CC/BCC with the owner inbox in staging (originals kept only as a count). Staging additionally REQUIRES a
server-supplied Drive verification proof (non-empty production denylist, or a staging-root ancestry
proof listing every destination; a denylist alone is not isolation and the ancestry proof must be
produced by a future consumer adapter), otherwise `OUTBOUND_DRIVE_VERIFICATION_REQUIRED`. Decisions
are frozen and provenance-registered; `applyStagingMailRouting` rejects forged or cloned decisions. It is a decision
helper only: no consumer is wired, no default inbox/folder IDs ship, and DWD scopes/IAM isolation must
be verified separately by the owner/admin. No `package.json` export entry yet; it is added with the
first consumer slice (tests import by relative path).

Validation: `packages/server-shared/tests/outbound-environment.test.ts` (node:test via tsx) and tsc typecheck.
Deployment: none.
