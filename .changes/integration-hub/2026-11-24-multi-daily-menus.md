# 2026-11-24 — Supplementary menu production contract

Extended the shared Menu Planning to Hub production contract with optional menu identity, service label, service time and kitchen notes. Hub retains these fields on canonical Production Orders and applies the service time to the production required-by context; explicit empty notes clear stale values on amendment.

Validation: focused Hub contract/domain tests (10 passed, 16 emulator cases skipped), typecheck and build. Deployment: staging pending; production not deployed.
