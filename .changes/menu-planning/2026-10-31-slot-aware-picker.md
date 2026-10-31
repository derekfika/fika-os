# 2026-10-31 — Slot-aware Week Planner dish picker

Week Planner now labels all six numbered Salad slots with their distinct subtypes, recommends dishes by explicit subtype or supported canonical registry tags, and automatically shows all category-compatible salads when no slot metadata matches. The explicit “All compatible dishes” browse mode remains available. New week templates include SALAD 5/6; existing saved weeks keep their stored slot lists. Creating from a Salad slot preselects its canonical subtype in the Dish Editor.

Validation: focused picker/template regressions (25 passed) and the full Menu suite (418 passed, 1 skipped), Menu typecheck and production build passed; exact-source CI pending.
Deployment: none. No catalogue or operational data changed.
