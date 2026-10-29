# 2026-10-28 — Hospitality Rotations dashboard UI foundation

Added a development-only, fixture-backed Hospitality Rotations preview with dynamic groups/categories, Dish Library search, a shared six-week planner, configurable rule ranges, seasonal version states and event-date preview. Added a server-side Hub session proxy for the documented Rotation API; no fixture route is exposed in production and no mock authorization or local persistence is used.

Validation: Hospitality suite (364 tests), typecheck, production build, `git diff --check`, and browser checks at desktop and 390px mobile passed. Browser checks covered keyboard reorder/copy, future-date version preview, and no horizontal overflow. ESLint could not start because the app has no ESLint 9 flat config. The production manager page remains pending the shared contract/Hub handler integration and Dish Library/catalogue provider interfaces.
Deployment: none.
