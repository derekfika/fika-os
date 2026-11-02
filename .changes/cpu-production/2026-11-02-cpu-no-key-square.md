# 2026-11-02 — CPU No Key Allergens square control

Replaced the master allergen matrix's No Key checkbox and visible status copy with the existing binary black/white allergen square. Accessible button name and pressed state remain available to screen readers; explicit declaration, mutual exclusion and review logic are unchanged.

Validation: CPU test suite passed (542 tests: 538 passed, 4 skipped, 0 failed); typecheck and production build passed. Staging interaction verification is pending because the governed deployment preflight could not obtain a Google Cloud access token (OAuth connection timeout).
Deployment: none; staging and production unchanged.
