# 2026-11-23 — Ad-Hoc checker projection and current verification

Hub accepts authenticated CPU checker projections into a derived, idempotent record, rejects stale source lineage and same-release resurrection, and verifies current CPU release state before exposing checker status or proxying PDF bytes. Order amendment and cancellation suppress old projection access.

Validation: `npm run typecheck`, targeted Firestore-emulator Ad-Hoc order/route suite (22/22 passed), and `npm run build` passed. Hosted retry scheduler and authenticated staging UAT remain unverified.
Deployment: none.
