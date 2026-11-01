# 2026-11-01 — #132 provisional menu section order contract

Added an isolated shared helper for provisional menu section, Hot Mains subgroup and SALAD 1–6 ordering, with deterministic legacy/custom-slot fallbacks. This foundation is not imported by runtime consumers and does not alter publications, projections, quantities, allergens, or historical evidence. The proposed hierarchy remains provisional pending Brian's confirmation.

Validation: shared contract tests passed (7/7); governed workflow tests passed (106/106). App tests: CPU 526 passed/4 skipped, Delivered-In 201 passed, Hospitality 434 passed, Logistics 704 passed, Menu Planning 426 passed/1 skipped. Hub's local test command exited 1 because this isolated worktree does not materialize the pinned `fika-platform-specs` gitlink; CI explicitly checks out that exact gitlink before Hub tests. Typecheck and build passed for all six affected apps. Exact-source CI pending.
Deployment: none.
