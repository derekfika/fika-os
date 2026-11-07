# 2026-11-07 — Reserve Beverage site authority in AUTHMOD

Add a Hub-owned read-only decision foundation for the reserved Beverage app ID. Require a revocation-checked session with an existing UID binding, explicit app admission and exact action grants, and current assignments for every canonical OPLOC. Keep approval separate and prevent the generic Full Access policy from admitting Beverage.

Validation: Six fictional decision tests, Hub AUTHMOD and Firestore emulator suites, 56 consumer contract tests, Hub typecheck and build. The Hub dependency audit reported existing advisories on the unchanged lockfile.

Deployment: Local validation only. HTTP transport, registry provisioning and hosted persistence are gated.
