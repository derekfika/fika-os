# 2026-11-11 — Keep legacy template aliases out of new canonical weeks

New weeks retain the canonical 29 placement rows and genuine extra capacity from permanent template settings, but do not seed legacy aliases already represented by canonical rows. Existing saved weeks, the permanent settings document, and drafts are unchanged. This follow-up is linked to the Week Planner save-validation P1 and PR #514.

Complexity: High. Recommended model: Sol. Reason: preserve menu row identity and historical planning data while aligning future week creation with the canonical contract.

Validation: Menu Planning tests passed (552 passed, 4 skipped); typecheck and production build passed. Governed repository validation was interrupted after repeated fixture worktree-preparation output; PR CI remains the authoritative workflow check. Production deployment: not authorized; no production data changed.
