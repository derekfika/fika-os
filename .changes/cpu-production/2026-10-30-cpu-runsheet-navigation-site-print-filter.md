# 2026-10-30 — CPU Run Sheet navigation and site-filtered print

Added shared week navigation and day selectors to Totals and Run Sheet. Run Sheet print now applies the selected canonical OPLOC IDs to the fresh whole-day read and labels that scope in the A4 output.

Validation: focused Run Sheet print test 4/4 passed; CPU typecheck passed; CPU production build passed. The full CPU suite was stopped after two cross-app notification tests reported failures after approximately 224 and 230 seconds; it did not finish with diagnostic details. Exact-source CI remains pending.
Deployment: none.
