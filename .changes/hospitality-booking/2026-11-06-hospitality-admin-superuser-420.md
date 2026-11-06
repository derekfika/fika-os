# 2026-11-06 — Company-wide Hospitality Admin booking access

Consume the Hub's live Hospitality Admin authority proof to enable the existing standalone and grouped amendment editors for eligible company-wide Superusers and explicit company-grant holders, including users without an OPLOC assignment. Normal customer date rules remain unchanged.

Validation: Hospitality full tests passed (434/434), typecheck passed, and production build passed. Hub Firestore amendment emulator verified late standalone and grouped changes using the returned live authority proof.
Deployment: not deployed. Source is ready for direct production deployment after protected PR merge and exact-source CI.
