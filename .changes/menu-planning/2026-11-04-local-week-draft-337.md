# 2026-11-04 — Local week drafts and unrestricted dish discovery (#337)

Week Planner edits use a recoverable per-identity/environment/week browser draft and explicit version-checked Save Week. Atomic diff saves preserve stable entry IDs, portions, allocations, server-owned allergen review and audit evidence; request receipts make retries idempotent. Conflicts retain drafts for explicit three-way review. Publication and downstream handoff remain separate.

The picker searches all canonical dishes and aliases, including uncategorised records. Recommendations rank rather than exclude. Optional contextual classification adds a registry menu-use tag without replacing primary category or prior uses. Canonical dish creation/classification remain explicit immediate catalogue actions.

Validation: focused draft/persistence/classification/search tests, Menu typecheck and production build passed during implementation. Full Menu suite initially reported 492 passed, 2 skipped and four legacy expectations requiring update. Browser and final complete-suite validation pending.
Deployment: none for this change; original production hotfix #336 remains serving. Canonical cross-app layout #334 remains a separate follow-on.
