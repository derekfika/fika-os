# 2026-11-06 — Deploy green merged sources directly to production

The supported release CLI and hosted runner use protected main PR provenance and exact-source CI for both environments. Authenticated execution records an operator note when supplied. Staging, release lanes and separate approval flags no longer determine software release eligibility. The CLI can record a missing or stale baseline from Firebase evidence while retaining immutable history, rollback and replay safeguards.

Validation: workflow and dashboard suites, changelog check, temporary Git repositories and simulated Firebase submission.
Deployment: none.
