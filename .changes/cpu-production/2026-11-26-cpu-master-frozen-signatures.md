# 2026-11-26 — Require frozen signatures for CPU master review

The CPU post-commit worker now derives review lineage from canonical Production Order and matrix scope. A date-wide master is signed or materialized only when every requested active order has a matching pending or current frozen release with both valid signatures. A first-role review without a frozen release remains pending.

Complexity: High. Recommended model: Sol. Reason: allergen signature authority and date-wide artifact safety across CPU orders.

Validation: Focused synthetic worker authority tests passed 4/4. The full CPU suite passed 706 tests, failed zero and skipped six opt-in browser tests (712 total). CPU typecheck passed. Production build passed with 18/18 pages generated. Changelog check and `git diff --check` passed.
Deployment: none.
