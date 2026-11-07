# 2026-11-07 — Enforce the Drive runtime gate on Hospitality matrix uploads

Hospitality matrix uploads use the shared verified production Drive boundary. Isolated route tests verify that staging cannot acquire a token or reach a Drive folder, and that verified production uses the governed site owner and storage folder.

Validation: 436 Hospitality tests passed, including the mocked production and staging Drive routes. Hospitality typecheck and production build passed. Deployment: none.
