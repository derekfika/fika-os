# 2026-10-29 — Hospitality Rotations manager moves into Menu Planning

The chef-facing Rotations manager now lives in Menu Planning at `/rotations` under a dedicated **Hospitality Rotations** navigation entry, separate from the Week Planner. It reuses the Hub rotation backend (six-week grid, groups, drafts, ordering, review-before-publish) through a session-forwarding proxy; Hub AUTHMOD still decides View/Manage/Publish.

Dishes gain an explicit `operationalScope` (missing = `MENU_PLANNING`) and a `hospitalityClass`. `HOSPITALITY_ROTATIONS` dishes are excluded by default from the Week Planner/Dish Library reads, by-ID reads, name matching, similar-dish merging, rolling-menu sync and the catalogue package/source hash; reads must pass `scope: "all"` to see them. Brian's nine-category taxonomy is unchanged. New "Hospitality dishes" panel creates a hospitality dish for a catalogue Item (deterministic ID, so no duplicates) and links it through the Hub, or links an existing hospitality dish. New dishes start with unrecorded allergens.

Validation: Menu Planning typecheck, build and full unit suite plus new scope/command tests. Not exercised in a browser or on staging.
Deployment: none.
