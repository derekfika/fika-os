# 2026-10-31 — Customer ordered quantities lead CPU chef displays

CPU calendar, day board, hospitality details, packing checklists and collection/run sheet prints show each recorded customer ordered quantity and unit first. Recorded recipe quantities appear only as secondary prep guidance. Event guest counts remain distinct and are never inferred from product lines; missing ordered quantity/unit or guest count is shown as “Needs verification”. No contracts, production data, workflow, packing fingerprints, fulfilment or Logistics state changed.

Validation: focused print/presentation tests 20/20 passed; CPU source-contract tests 41/41 passed; CPU typecheck and production build passed; workspace scope/changelog checks passed. The local full suite and isolated notification test require an unavailable Firestore emulator (`127.0.0.1:8085`, gRPC 14 UNAVAILABLE / ECONNREFUSED). Exact-head CI initially found two stale CPU source assertions for the removed line-to-guest fallback and the old calendar quantity markup; those assertions are corrected and retested, with fresh exact-head CI pending. Style Guide compliance: PASS.
Deployment: none.
