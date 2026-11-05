# 2026-11-05 — CPU Menu totals and allergen review order

CPU Published Menu destination views, production Totals, and master allergen review rows now follow the shared 29-slot Menu order. Destination rows preserve each slot occurrence; production Totals aggregate a canonical dish across slots and place it at its first slot. Allergen evidence identity, review state, and unknown/unrecorded semantics are unchanged.

Validation: focused production-day and published-menu-selection tests (20 passed), CPU typecheck, and production build. Staging UAT and deployment not performed; the release acceptance path remains blocked pending staging verification and Drive-isolation controls.
Deployment: none.
