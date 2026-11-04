# 2026-11-04 — Preserve CPU signed-PDF production coverage

Move the successful Ad-Hoc signed-PDF Drive mock into production runtime mode. Staging DWD is fail-closed until isolation is verified; its denial is covered by the Drive readiness tests.

Validation: `npx tsx --test tests/ad-hoc-signing.test.ts` — 4 passed.
Deployment: none.
