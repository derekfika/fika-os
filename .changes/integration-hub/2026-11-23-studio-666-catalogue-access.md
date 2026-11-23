# 2026-11-23 — Keep Hub authority for Studio catalogue management

The existing Hub command route checks request origin and retains its session, permission and transaction checks. The administrative view exposes company defaults and stored site exceptions needed by Studio.

Validation: focused Hub tests, typecheck and 30 isolated Firestore catalogue tests.
Deployment: none.
