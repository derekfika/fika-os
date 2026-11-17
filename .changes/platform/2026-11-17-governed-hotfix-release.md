# 2026-11-17 — Governed production hotfix release capability

Summary: Added a fail-closed production hotfix evidence policy and documented a baseline-derived, per-application release design that preserves existing locks, journals, rollback and append-only application history. The normal main-only deployment path is unchanged and no hotfix deployment command was activated. Built local RCoA source candidates from the verified Hub and Hospitality serving baselines for compatibility review.

Validation: Policy unit tests, isolated Hub and Hospitality historical-amendment tests, typechecks and builds: see task report for actual outcomes. No GitHub protection was changed, no staging or production deployment was run, and no operational data was changed. GitHub branch protection/ruleset evidence and exact-source hosted PR checks remain unavailable for the hotfix target, so the candidates are not release eligible.

Deployment: Not deployed. Production route activation requires a separately reviewed implementation and owner approval.
