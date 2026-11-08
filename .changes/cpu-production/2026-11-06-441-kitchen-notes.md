# 2026-11-06 — Project and print internal kitchen notes

CPU notes-only projection events rebuild day/week read packages without changing calendar, Logistics or allergen-review state. CPU booking context and internal run-sheet print display escaped multiline kitchen notes separately from customer booking notes.

Validation: `npm run typecheck`; `npx tsx --test tests/cpu-projection.test.ts tests/run-sheet-printing.test.ts` (22 passed); `npm run build` passed. Full `npm test` was interrupted after the menu-planning notification test reported a 222-second timeout. Deployment: none.
