# 2026-10-31 — Align Sent to CPU dashboard filtering

Use the same current-production-order-derived display status for standalone booking status choices and row filtering as the dashboard status pill. This lets operators filter a completed booking that has a live current CPU handoff as “Sent to CPU” without changing its canonical lifecycle status. The inverted date-range alert was already present on current main and is unchanged.

Validation: pending focused test, typecheck and exact-source CI.
Deployment: none; no bookings, permissions or operational data were changed.
