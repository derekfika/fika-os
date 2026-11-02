# 2026-11-02 — Require explicit booking service selection

Removed the implicit Dining selection from the Services and Locations editor. Managers opening the editor from an Item or category must now choose the service unless a deep link explicitly names one.

Validation: `npm run typecheck` passed; `npx tsx --test tests/hospitality-catalogue-services.test.ts` (4 passed).
Deployment: none.
