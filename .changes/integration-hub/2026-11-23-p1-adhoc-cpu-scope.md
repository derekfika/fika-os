# 2026-11-23 — Preserve Ad Hoc CPU scope in Hub handoff

Hub validates the existing CPU workstream values and maps selected scope to canonical Production Order line routing. Legacy Ad Hoc requests default to Hospitality; amendments reroute the same order, preserve its single Logistics requirement, enforce started-work restrictions, and invalidate stale allergen checker state.

Validation: Hub typecheck and emulator integration passed, including all three scopes, rerouting, started-work refusal, cancellation, and allergen projection invalidation (25/25).
Deployment: Hub staging build `build-2026-11-23-004`, source `a2e123b4af1629828e4046004b74ae423161d41d`, 100% traffic, release `7a5335aa-ba8f-4162-9139-dc0b9fedb426`. Governed smoke returned 200. Authenticated browser UAT is BLOCKED by a mismatched desktop capture surface. No production deployment.
