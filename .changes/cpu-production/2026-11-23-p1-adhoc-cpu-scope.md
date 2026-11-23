# 2026-11-23 — Route Ad Hoc production by CPU scope

Canonical order and CPU projection filters now honor the selected Ad Hoc workstream, default legacy rows to Hospitality, and keep each order in one scope while retaining All Production visibility. Day views, totals, and run sheets include Sandwiches and Delivered-In routed Ad Hoc lines. Existing canonical order and Logistics fulfilment identity remain intact.

Validation: CPU typecheck, focused scope/day/run-sheet regression tests (41 passing), and production build passed. The CPU emulator suite passed 31 of 32 cases; dual-signature and source-change revocation checks passed, while one artifact persistence assertion failed because the local PDF renderer produced no output file. A broader CPU unit run was stopped after prolonged unrelated notification failures; its isolated scope regression passes.
Deployment: none.
