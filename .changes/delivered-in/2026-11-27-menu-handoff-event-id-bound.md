# 2026-11-27 — Accept canonical Menu handoff event IDs

Raised the bounded Delivered-In invalidation event ID limit to 512 characters so composed canonical Menu Planning publication IDs are accepted. Existing authentication, OPLOC/day scoping and invalidation semantics are unchanged.

Complexity: Low. Recommended model: Luna. Reason: the persisted staging outbox records and route validator confirm an isolated request-length mismatch.

Validation: focused regression test passed (the exact staging event ID is 253 characters); all 240 Delivered-In tests passed; `npm run typecheck` passed; `npm run build` passed.
Deployment: not deployed. Staging end-to-end verification is pending protected integration and staging deployment.
