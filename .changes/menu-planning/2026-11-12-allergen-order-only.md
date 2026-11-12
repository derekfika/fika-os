# 2026-11-12 — Allergen Checker order only

Restore the Allergen Checker to its pre-#517 continuous matrix and preserve its prior allergen editing, draft, review, and save behavior. Sort visible dishes by the same per-week slot sequence rendered by Week Planner, retaining saved slot identities and same-slot entry order, including custom and historical rows.

Validation: Menu Planning tests 556 passed, 4 skipped; typecheck and production build passed. Regression coverage compares all 29 slots across Monday–Friday, historical aliases, authored additional rows, repeated dishes, and the original single-matrix UI/save path.
Deployment: staging pending governed merge and release; production not deployed.
