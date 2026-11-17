# 2026-11-17 — CPU Master Signing Scope Errors

CPU master allergen signing now checks that the caller's CPU Production site scope covers each source order before reporting matrix membership errors. Incomplete scope returns a clear AUTHMOD 403.

Validation: allergen signing/signoff tests (24 passed); CPU typecheck and production build passed. Staging validation pending.
Deployment: none.
