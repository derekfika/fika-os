# 2026-11-20 — Preserve accepted Studio kitchen evidence in the Hub handoff

Hub can attach a frozen kitchen specification to a CPU-routed Production Order line after verifying its private acceptance record against the saved Quote Revision, booking commercial version, event date, canonical site and line details. Replay preserves the existing order and its evidence. A booking marked as carrying Studio evidence fails closed if the private record is missing or invalid.

The per-quote private record stays outside customer and staff booking payloads. Only Studio-marked CPU handoffs read it. Earlier bookings and in-house work keep their existing paths. A future acceptance writer must verify the publication and signed evidence and commit the marker and private record with the booking and quote.

Validation: Hub typecheck and 10 isolated Firestore emulator tests passed. The tests cover replay, missing or stale evidence, quantity and line validation, legacy client choices and in-house routing.
Deployment: none.
