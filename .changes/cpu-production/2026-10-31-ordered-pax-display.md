# 2026-10-31 — Customer ordered quantities lead CPU chef displays

CPU calendar, day board, hospitality details, packing checklists and collection/run sheet prints show each recorded customer ordered quantity and unit first. Recorded recipe quantities appear only as secondary prep guidance. Event guest counts remain distinct and are never inferred from product lines; missing ordered quantity/unit or guest count is shown as “Needs verification”. No contracts, production data, workflow, packing fingerprints, fulfilment or Logistics state changed.

Validation: focused print/presentation tests 20/20 passed; CPU typecheck and production build passed; workspace scope and changelog checks passed. The full CPU suite could not complete because Firestore emulator `127.0.0.1:8085` was unavailable; an isolated notification test failed with `14 UNAVAILABLE` / `ECONNREFUSED`. Exact-head PR CI pending. Style Guide compliance: PASS (existing semantic text/surface styles, readable quantity hierarchy and explicit verification labels).
Deployment: none.
