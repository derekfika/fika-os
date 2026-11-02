# 2026-11-02 — CPU No Key Allergens square control

Replaced the master allergen matrix's No Key checkbox and visible status copy with the existing binary black/white allergen square. Accessible button name and pressed state remain available to screen readers; explicit declaration, mutual exclusion and review logic are unchanged.

Validation: `no-key-allergen-contract.test.ts` and `allergen-review-safety.test.ts` passed (17 tests); CPU typecheck and production build passed. Staging interaction verification pending.
Deployment: none.
