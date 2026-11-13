# 2026-11-13 — Hot Fork Buffet server preview and ordering gate

Added a bridge-authorised, versioned menu provider. The established Gold/Silver menu-on-request booking and amendment path remains available in staging; any submitted structured selector choice is rejected while package allocation rules await approval. Existing site catalogue records remain the price authority. A selected menu is retained in the booking, quote snapshot and existing direct CPU handoff; amendments retire prior production orders with a visible replacement-send state. Selected quotes show frozen dish choices and suppress conflicting legacy four-salad copy. Removed the old buffet-demand and preview proxies to Menu Planning, including preview links from buffet notifications.

Validation: Hub typecheck, 38 focused booking/quote/notification tests and a clean production build passed. The full Hub suite had one missing `fika-platform-specs` submodule file failure; all other tests passed, with emulator cases skipped. The source has no verified dietary/allergen declarations, and salad/dessert production allocation rules remain pending.

Deployment: none.
