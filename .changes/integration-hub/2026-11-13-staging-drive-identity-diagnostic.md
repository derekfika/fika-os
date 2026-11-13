# 2026-11-13 — Staging Drive identity diagnostic

Separate staging Drive email and permission-ID checks, and log the expected and observed non-secret permission IDs only when that identity check fails. This keeps the isolation guard closed while making a misbound staging identity diagnosable.

Validation: staging Drive identity tests and full `fika validate` passed, including Hub, Hospitality and CPU tests/typechecks/builds. Staging deployment pending.
Deployment: pending governed merge and staging verification.
