# 2026-11-13 — Hot Fork Buffet server preview and ordering gate

Added a bridge-authorised, versioned menu provider and a fail-closed customer booking/amendment gate while package allocation rules await approval. Existing site catalogue records remain the price authority. A selected menu is retained in the booking, quote snapshot, demand view and existing CPU handoff; amendments retire prior production orders with a visible replacement-send state. Selected quotes show frozen dish choices and suppress conflicting legacy four-salad copy.

Validation: Hub typecheck, 28 focused menu/quote tests and a clean production build passed. The full Hub suite had 1,064 passes, 122 emulator skips and one unrelated missing `fika-platform-specs` submodule file failure. The source has no verified dietary/allergen declarations, and salad/dessert production allocation rules remain pending.

Deployment: none.
