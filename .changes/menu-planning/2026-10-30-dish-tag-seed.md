# 2026-10-30 — Staging seed of the approved Dish Library tag vocabulary (#152)

Adds the owner-approved starting tag vocabulary from `FIKA_Dish_Library_Tag_Rescan_2026-10-29.xlsx` (High and Medium sheets): 28 tags — 8 dish-type (Vegetable Side, Grain / Pulse, Chicken, Leaf Salad, Fish / Seafood, Slaw, Beef, Bread), 12 cuisine and 8 preparation/style. The eight type words that duplicate a governed primary category (Salad, Hot Main, Soup, Sauce, Garnish, Side, Cold Protein, Vegetarian Main) are deliberately excluded; the workbook has no occasion tags. `scripts/seed-dish-tags.ts` is dry-run by default, refuses every project except staging (`fika-os-dev`), adds only missing tags in one transaction, never edits or removes a tag, assigns no tag to any dish and is safe to re-run. It is not wired into the app or any deployment.

Staging action taken: the script was run once with `--execute` against `fika-os-dev` on 30 Oct (registry version 0 → 1, 28 tags); a second run added nothing. Rollback: delete the single document `fikaMenuPlanningCatalogue/dish-tag-registry` in `fika-os-dev`. Production was not touched. Per-dish tag assignment and the sixth salad subtype are separate, still open.

Validation: Menu Planning typecheck, 4 new tests plus the 11 registry tests; see the PR for the governed validation.
Deployment: none (the Menu app is not deployed by this change).
