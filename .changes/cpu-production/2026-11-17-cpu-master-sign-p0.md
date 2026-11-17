# 2026-11-17 — CPU master allergen signing recovery

Made exact same-actor, same-role, same-lineage signature retries idempotent and report the failing source order and authorization/lineage conflict explicitly. Master review membership now excludes withdrawn orders consistently; one-off destinations stay request-scoped and are excluded from Delivered-In OPLOC invalidations. Bounded oversized consumer event IDs so a valid CPU commit does not leave its durable downstream delivery permanently rejected. Allow the second-role worker to advance a pending review after the first-role job completed.

Validation: CPU typecheck and production build passed. Focused `allergen-signoff-access`, `allergen-signing-lineage`, `production-day`, and `cpu-master-review` suites passed (47 tests); the new outbox regression passed separately (1 test). The full `cpu-durable-outbox` suite did not complete because its existing delivery test keeps the runner alive. No staging or production data was used.
Deployment: none; production data, permissions, and releases were not changed.
