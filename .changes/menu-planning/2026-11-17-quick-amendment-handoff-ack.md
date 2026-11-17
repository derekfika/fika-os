# 2026-11-17 — Confirm Logistics handoff before publication delivery

Menu Planning now keeps a publication outbox event retryable until Hub confirms both CPU and Logistics projection delivery. This closes the acknowledgement gap without changing Hub APIs or publication evidence.

Validation: focused production-client and publication-outbox tests passed (9/9); Menu Planning typecheck passed. Authenticated signature-preservation UAT remains pending.
Deployment: none.
