# 2026-11-06 — Confirm pending addresses from the planning queue

The Details inspector lets a Logistics manager confirm the delivery address for a Menu one-off. Assignment and dispatch fail closed while the address is pending. Driver navigation uses the confirmed address snapshot.

Validation: Logistics typecheck, one-off routing tests and isolated Firestore tests passed. The cross-app test checks dispatch before and after confirmation.
Deployment: pending governed release.
