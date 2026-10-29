# 2026-10-29 — Audited recovery of exited dev operations

A stopped dev process can leave an operation marker that prevents normal workspace completion. Adds canonical administrator-only `workspace recover-dev`: verifies the recorded process is absent, matches the original lease, checks all allocated ports for orphan listeners, preserves the operation in an audit event, then removes only that marker under the registry lock. It does not finish/revoke leases or recover release/integration operations.

Validation: focused recovery and real socket-listener regressions passed; governed full workflow suite passed 82/82. Exact-source CI is required before integration and recorded on the PR. No application code changed or application build required.

Deployment: none. Local tooling only; no production, Firestore, infrastructure or permission changes. No recurring reads or audit writes; recovery creates one explicit local audit event.
