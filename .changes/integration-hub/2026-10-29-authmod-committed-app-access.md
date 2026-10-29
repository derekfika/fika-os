# 2026-10-29 — Report committed AUTHMOD app-access saves accurately

Rebuild PR #13 on current main for delivery issue #118. After an application bundle transaction commits, invalidate reference/admission caches before publishing its access package. A failed package publication returns the authoritative saved account with an explicit committed warning, rather than reporting a failed save. Stale packages remain fail-closed; inactive identities intentionally publish no package. Preserve existing transaction/audit/security-head and authorisation semantics.

The account UI keeps the saved checkbox state and announces the warning using semantic warning tokens. The production route delegates unchanged command handling to a testable handler; its real AUTHMOD administrator resolver remains mandatory.

Validation: four focused unit/response tests and the actual HTTP-handler/Firestore-emulator regression passed. The emulator verifies assignment/grant/audit persistence, cache invalidation, stale-package denial, revocation, inactive identities, successful publication, version conflicts and unauthenticated rejection. Added the regression to existing emulator CI. Full Hub suite: 829 passed / 103 skipped. Typecheck and production build passed. The initial missing pinned-spec dependency was restored from exact gitlink c96939d2, with blob hashes verified; no spec assertion was bypassed. Workflow validation: 80 passed. Exact-source CI is recorded in the PR.

Deployment: not deployed. No live assignments, credentials, worker or permission configuration changed. No new recurring reads, audit model or package-rebuild mechanism introduced. Style Guide compliance: PASS for the new warning surface.
