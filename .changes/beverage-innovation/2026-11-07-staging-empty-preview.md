# 2026-11-07 — Show empty Beverage staging preview

Remove fictional operational data from the restricted staging presentation while preserving its approved shell, navigation and a blank in-memory drink editor. Local `/mock` retains the original fixture reference for visual comparison. No Beverage service, storage or external effects are connected.

Validation: 39 Beverage unit/component tests, typecheck and build passed; `fika affected` and changelog checks passed. Staging presentation tests cover the empty metrics, navigation, blank editor and absence of fixture records.
Deployment: none.
