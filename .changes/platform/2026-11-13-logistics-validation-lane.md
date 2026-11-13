# 2026-11-13 — Run Logistics validation beside tests

Give affected Logistics changes a dedicated cached typecheck and exact-source production build lane, parallel to the unit-test job. The required merge gate now checks both lanes. Other applications and their existing validation paths are unchanged.

Validation: the Logistics CI routing regression test, 721-case full suite, typecheck and production build passed locally. Exact-source GitHub Actions validation is required before integration. Deployment: none.
