# 2026-11-02 — Keep Dish Library search local

Dish Library query and filter changes now reuse the loaded canonical catalogue instead of restarting IndexedDB loading and setting the loading state. Successful duplicate merges explicitly reload the catalogue after cache invalidation so the list still reflects canonical server state.

Validation: focused read-paths and browser-filter tests (39 passed), Menu typecheck and production build passed. Source comparison: ten query changes caused eleven load-effect runs before; after, there is one mount load. No browser/network fixture was run.
Deployment: none.

