# 2026-11-13 — View existing service-date master allergen checker

Added a CPU-only date-based View / Print Master Allergen Checker action. Reads current canonical Menu orders, exact completed master-review membership and matching dual-signed releases; reuses the shared master artifact and existing bounded PDF/hash/access checks. All-site CPU authority is required because the master contains every OPLOC. Revalidates authority after download. No generation, signing, persistence, ACL, schema or authentication changes.

Validation: focused security tests 12/12, CPU typecheck and production build passed. The local full suite stalled in the existing consumer-invalidation/durable-outbox workers and was stopped; exact-source CPU CI is required and recorded in the PR. Deployment: none pending source-scope assessment; current main contains previously unreleased Totals and staging-provider changes that the owner excluded from this release.
