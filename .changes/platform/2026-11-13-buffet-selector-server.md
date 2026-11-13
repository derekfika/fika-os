# 2026-11-13 — Versioned Hot Fork Buffet source menu

Recorded Sam's 44 source dishes with stable IDs and explicit unrecorded allergen and dietary states. The feta dish remains in its source Vegan category but requires review before selection. Shared validation enforces confirmed main, salad and dessert choice constraints and preserves the menu version and frozen portion choices in the selection DTO. The shared Hospitality quote renderer prints selected dishes and omits contradictory old catalogue descriptions. The selection DTO has no Menu Planning dependency.

Validation: Hub, Hospitality, CPU and Menu Planning typechecks and production builds passed; focused Hub booking/quote/notification and CPU choice detail tests passed. Full Menu Planning passed; full Hub had one missing specs submodule failure; full CPU stalled on unchanged consumer-invalidation tests and was stopped after a bounded retry timed out.

Deployment: none.
