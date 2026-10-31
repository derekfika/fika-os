# 2026-10-31 — Ranked dish tag suggestions

Menu Planning now ranks up to five optional tag suggestions using whole phrases, bounded token matches, UK spelling and culinary synonyms, and explicit weights with visible reasons. Fish sauce does not imply a Fish main tag; substring matches such as ham in chamomile are excluded. Optional similarity hints use only existing tagged dishes. Accepted and dismissed choices are saved locally only when the editor user opts in. No dish, registry or published menu data is changed.

Validation: focused dish-editor tests (23 passed); Menu Planning suite (410 passed, 1 skipped); Menu Planning typecheck and production build passed. Build/test local data writes were restored. Deployment: none.
