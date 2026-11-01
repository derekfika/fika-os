# 2026-11-01 — Logistics build provenance endpoint (#120)

Added a dynamic, no-store `/api/build-info` endpoint that returns only Logistics' validated full source SHA, plus an exact hosted admission bypass. Configured the same authoritative SHA as the Next build ID and injected runtime identity.

Validation: focused build identity and admission tests passed (7/7); Logistics typecheck and production build passed. Exact-source PR CI run #447 passed, including the full Logistics test suite, typecheck and production build.

Deployment: none; not deployed.
