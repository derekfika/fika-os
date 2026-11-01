# Issue #120: Logistics build provenance endpoint

- Date: 2026-11-01
- Summary: Added a dynamic, no-store `/api/build-info` endpoint that returns only Logistics' validated full source SHA, plus an exact hosted admission bypass. Configured the same authoritative SHA as the Next build ID and injected runtime identity.
- Validation: Focused build identity and admission tests passed (7/7); Logistics typecheck and production build passed. Exact-source CI: pending PR.
- Deployment: Not deployed.
