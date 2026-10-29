# 2026-10-29 — Build Rotations with Hub-only dependencies

Resolve shared-contract Zod types through Hub's own installed dependency, matching the existing webpack alias. This preserves strict inferred schema types without relying on root node_modules in App Hosting. No runtime contract, permissions, persistence or domain validation changed.

Validation: reproduced missing Zod and implicit-any errors with an isolated app-only install; app-only strict typecheck and production build passed, module-resolution regression passed, four focused domain/auth tests passed, five isolated-emulator tests passed, and the full Hub suite passed (831 passed, 103 skipped). The initial full-suite run had one missing pinned Specs fixture; the two fixtures were restored at their exact gitlink blob hashes before rerunning.
Deployment: pending Hub staging; no production change.
