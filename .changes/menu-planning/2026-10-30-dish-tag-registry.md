# 2026-10-30 — Shared Dish Library tag registry and tag-aware dish writes (#152)

Adds a versioned central registry of descriptive dish tags (groups: type, cuisine, ingredient, style, occasion) with stable `dish-tag:<group>:<slug>` IDs, synonyms, canonical spelling, case/accent-insensitive de-duplication and bounded size. `GET /api/dish-tags` returns a searchable, grouped list; `POST /api/dish-tags` (`create-tag`) creates a tag inline and is idempotent: an equivalent existing tag is returned (200) instead of a duplicate (201 on create), and an optional `expectedVersion` rejects stale writers with 409 unless an equivalent tag already exists. The registry is one small document (`kind: "dish-tag-registry"`) in the existing catalogue collection, so the dish listing never sees it; it is written in one Firestore transaction.

Dishes gain an optional `tagIds` list. `create-dish` and `update-dish` accept it and reject unknown IDs with 422 rather than silently dropping them; omitting it leaves a dish's tags unchanged and an empty list clears them. Tags are separate from the governed primary category and from the salad subtype (`subcategory`), which are untouched. Legacy dishes with no tags remain valid, and published menus, aliases, canonical IDs, quantities and allergen evidence are not changed. Catalogue entries expose `tagIds` when present.

Not included: the approved 81 medium / high tag list. It is not in the repository or issue text, so no tags are seeded; an additive `mergeSeedTags` helper is provided for a governed seed once the list is supplied. No UI (that is #154 and #155), no migration, no production writes.

Validation: Menu Planning typecheck and 11 new tests; see the PR for the full suite, build and governed validation. Not exercised against a Firestore emulator or staging.
Deployment: none.
