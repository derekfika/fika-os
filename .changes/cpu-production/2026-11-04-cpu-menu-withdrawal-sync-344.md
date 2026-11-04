# 2026-11-04 — Revoke CPU allergen authority on Menu withdrawal

When Integration Hub synchronises a cancelled or superseded Menu Production Order, CPU now clears its current signatures, signed artifacts and release, retains revoked historical evidence, and stages the Delivered-In revocation in the same guarded plan transaction. The Delivered-In review and PDF route checks current canonical source and current release authority before exposing signed content. A review read now makes one bounded Hub service-date queue call; signed package reads also load the affected plan IDs. Revocation adds one durable CPU change and outbox obligation only when signed authority existed.

Validation: isolated Firestore-emulator route regression for cancellation, replay, outbox and PDF denial; CPU typecheck and Next.js build passed.

Deployment: none.
