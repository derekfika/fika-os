# 2026-11-06 — Save published-menu working drafts

Adds an explicit Week Planner working-draft mode for currently published days. Saves update rolling working rows and server-stamp the current publication-day lineage while leaving immutable publication snapshots and outbox events unchanged. Legacy single-day and whole-week republish paths reject only when a saved working-draft marker still matches current published lineage. Superseded/withdrawn days and shared row/template edits remain locked. Scoped day-and-site publication is not implemented; saved changes remain unpublished.

Adds a deterministic, read-only comparison of the active published snapshot and current working week. Its version-pinned change set reports added, removed, replaced and quantity-changed demand by source day, site and stable dish identity, retaining before/after allergen evidence. The whole-week saved-draft publication guard remains in place; this comparison does not publish or mutate operational data.

Validation: initial working-draft coverage `npm exec -- tsx --test tests/week-draft.test.ts tests/week-draft-save.test.ts` (16 passed); focused amendment comparison and guard tests (5 passed); `npm run typecheck` passed. `tests/rolling-menu.test.ts` had 51 passed and one pre-existing single-day republish assertion failure at line 580. `git diff --check`.
Deployment: none.
