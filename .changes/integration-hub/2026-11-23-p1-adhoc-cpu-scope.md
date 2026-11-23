# 2026-11-23 — Preserve Ad Hoc CPU scope in Hub handoff

Hub validates the existing CPU workstream values and maps selected scope to canonical Production Order line routing. Legacy Ad Hoc requests default to Hospitality; amendments reroute the same order, preserve its single Logistics requirement, enforce started-work restrictions, and invalidate stale allergen checker state.

Validation: Hub typecheck and emulator integration passed, including all three scopes, rerouting, started-work refusal, cancellation, and allergen projection invalidation (25/25).
Deployment: none.
