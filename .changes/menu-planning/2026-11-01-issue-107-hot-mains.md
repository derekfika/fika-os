# 2026-11-01 — Group hot mains in Week Planner

**Complexity:** Low. **Recommended model:** Luna. **Reason:** isolated presentation projection and renderer change; existing row identities and planning data remain authoritative.

Week Planner now renders one HOT MAINS banner containing the existing Hot Main/Hot Meat, Fish, Vegan/Veggie Main and Soup rows in that order. The projection preserves row identities, within-subgroup ordering, authored snapshots and historical entries. No picker, publication or downstream contract behavior changed.

Validation: governed `fika validate --base origin/main` passed (106 workflow tests; 426 Menu tests passed, 1 skipped; typecheck and production build). Deployment: none.
