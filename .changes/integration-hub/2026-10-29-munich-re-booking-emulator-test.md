# 2026-10-29 — Munich RE booking emulator test

Adds an isolated-emulator test that submits Munich RE bookings through the real Hub route: minimum 5 rejected at 4 and accepted at 5, room and collection-point persistence, governed pricing, idempotent replay, cancellation retaining the location, and the CPU routing plan (unmapped form items report routing required).

Validation: passes under the Firestore emulator; the Angel Court ingestion emulator test still passes. CPU hand-off, Logistics and amendment propagation are not covered (need a saved quote PDF; staging).
Deployment: none.
