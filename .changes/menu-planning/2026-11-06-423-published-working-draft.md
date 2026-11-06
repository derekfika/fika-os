# 2026-11-06 — Save published-menu working drafts

Adds an explicit Week Planner working-draft mode for currently published days. Saves update rolling working rows and server-stamp the current publication-day lineage while leaving immutable publication snapshots and outbox events unchanged. Legacy single-day and whole-week republish paths reject only when a saved working-draft marker still matches current published lineage. Superseded/withdrawn days and shared row/template edits remain locked. Scoped day-and-site publication is not implemented; saved changes remain unpublished.

Validation: `npm exec -- tsx --test tests/week-draft.test.ts tests/week-draft-save.test.ts` (16 passed); `npm run typecheck`; `git diff --check`.
Deployment: none.
