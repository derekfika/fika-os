# 2026-11-16 — Immediate RCoA Calendar outbox delivery

After successful Hospitality CPU projection, Hub immediately replays the matching committed Calendar outbox event through the existing leased, idempotent worker. Calendar errors remain retryable by the existing Scheduler and do not undo CPU order creation. Amendments and cancellations use their deterministic domain event identities; existing site gating remains authoritative.

Validation: focused Calendar outbox tests (9/9), Hub typecheck and production build passed. Broad Hub suite: 1,079 passed, 124 existing skips, one Address-policy test could not read the pinned platform-specs submodule because this environment could not fetch it. Updated the Hub CI contract test to match the current CPU-only shared-contract step. Staging deployment and authenticated UAT pending.
Deployment: none.
