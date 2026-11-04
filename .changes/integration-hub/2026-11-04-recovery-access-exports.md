# 2026-11-04 — Authorise one-off destination visibility explicitly

Hub Delivered-In access returns an explicit one-off visibility capability only for an authenticated integration administrator with global Delivered-In scope. Grab & Go and site-scoped/non-admin users do not receive that capability; existing governed OPLOC/service filtering is preserved. Supports recovery issue #344 without creating fake OPLOC identities. No business writes, migrations, polling or audit writes are added.

Validation: Hub focused access tests 5 passed, including actual HTTP handler execution for role/scope/service combinations and authority/package failures; Hub full suite: 951 passed, 116 skipped after restoring two docs at the pinned specs gitlink; Hub typecheck and production build passed. Governed validation: 138 workflow tests passed; one unchanged sweep-preview test failed before the app phases, which were run independently.
Deployment: none; integrated staging/browser UAT remains with the recovery coordinator.
