# 2026-11-03 — Keep CPUX Calendar publishing disabled by default

The active CPU staging manifest now explicitly disables Calendar publishing and historical backfill. The final production and staging manifests receive the same defaults in the guarded publisher change; no Calendar ID or write principal is configured here.

Validation: combined configuration assertions are pending final integration. Deployment: none.
