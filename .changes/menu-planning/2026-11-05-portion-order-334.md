# 2026-11-05 — Portion Planner canonical slot order

The Portion Planner now orders populated rows by the shared versioned 29-slot menu contract, with legacy and unknown rows retained after canonical slots in stable authored order. The planner sorts a copy for display and leaves saved snapshot entries, portion values, allocations, and publication data unchanged.

Validation: focused ordering regressions, Menu Planning typecheck and build. Staging UAT and deployment status are recorded separately after release verification.
Deployment: none.
