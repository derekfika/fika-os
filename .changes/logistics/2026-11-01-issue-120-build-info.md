# 2026-11-01 — Logistics build provenance endpoint (#120)

Added a dynamic, no-store `/api/build-info` endpoint that returns only Logistics' validated full source SHA, plus an exact hosted admission bypass. Configured the same authoritative SHA as the Next build ID and injected runtime identity.

Validation: focused build identity and admission tests passed (7/7); Logistics typecheck and production build passed; exact-source CI pending on PR #238.

Deployment: none; not deployed.
