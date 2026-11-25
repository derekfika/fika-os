# 2026-11-25 — Canonical product menu drafts

Studio now supports one working draft per canonical Hospitality product through an additive API. A product starts with a fixed menu or a one- to 52-week rotation. Saved drafts keep ordered choices and groups, presentation intent and exact reusable dish revisions. Studio admission and the current Hub catalogue govern access. Draft writes retain an immutable actor-bound version, and the catalogue-facing list returns bounded summaries.

Legacy menus and published packages stay available through their existing routes. Product draft publication, site-specific schedules and legacy adoption require separate provider work.

Validation: Studio unit tests, typecheck, production build and isolated Firestore tests for concurrent create, retry, stale saves and exact dish revision binding. Hub publication, Hub pricing, Hospitality portal and offline legacy planner regressions passed.

Deployment: none.
