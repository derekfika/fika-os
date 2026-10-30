# 2026-10-30 — Golden test: seeded service layout equals today's portal categories (#175 slice 1)

Adds a test proving the governed service-layout seed reproduces RCoA's `rcoaEventTypes` categories and the shared
BookingPortal map exactly. No Hospitality runtime behaviour changes; portals still use their own lists until slice 3.

Validation: Hospitality typecheck and 32 tests passed. Deployment: none.
