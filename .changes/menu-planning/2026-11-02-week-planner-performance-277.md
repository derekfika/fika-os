# 2026-11-02 — Restore Menu caches and reduce planner input work

Unify week/catalogue IndexedDB opens and v2→v3 migration, preserve existing v3
records and fail closed when the catalogue identity is unknown. Retain bounded
blocked-open recovery. Index copy availability once per snapshot, memoize grid
reconciliation and dictionary-instance suggestions, and keep picker typing local.
Adopt #278's shared tag client without changing canonical copy/publish rules.

Validation: full Menu suite 480 passed/one existing emulator skip; real Chromium
cache scenarios included. Typecheck and production build passed. Sixteen relevant
browser tests passed; three older E2E failures reproduced against deployed source
and are documented in the report. At 108 entries/500 dishes/26 Hunspell findings/
70 V2 notices/4× CPU throttle, median native input-to-paint improved 341→50 ms.
Style Guide compliance: PASS for changed surfaces; existing styling retained.

Deployment: none at this implementation checkpoint. Staging provenance/UAT and any
separately authorised production release are recorded in the governed release ledger
and #277. No production menu, recipe, allergen, permission or worker mutation.
