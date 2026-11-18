# 2026-11-18 — Carry accepted Studio kitchen evidence through Hub production handoff

Hub verifies a private acceptance record against the current saved Quote Revision, Booking commercial version, service site/date and canonical line binding before it creates a Hospitality Production Order. It copies validated kitchen specifications to CPU-routed lines and retains the frozen values on retry. The existing production event captures the line revisions as part of the canonical handoff.

The handoff reads one fixed private document for a CPU-bound booking with a saved quote. Ordinary booking reads and in-house-only services use their existing paths. The acceptance record stays outside customer and staff Booking payloads. Before enabling Studio booking acceptance, its server-side writer must verify the publication and signed dish evidence and atomically persist the private proof with its Booking/Quote activation. Booking imports and amendments do not author approval evidence.

Validation: Hub typecheck, build and the isolated Firestore emulator suite passed. The Booking → Quote → Production Order tests cover valid handoff/replay, stale and invalid rejection before writes, legacy client choices, privacy and in-house routing.

Deployment: none.
