# 2026-11-04 — Preserve specific allergen notes in CPU exports

The checker export renders specific nut/gluten/allergen detail notes separately from may-contain qualifications, with HTML escaping and legacy rows supported. Allergen states and signing/persistence authority are unchanged. Supports recovery issue #343; the producer/persistence work is delivered by the coordinated recovery branch.

Validation: focused CPU allergen/export tests 20 passed; CPU typecheck and production build passed. Full CPU suite: 559 passed, 4 skipped, 1 unchanged Windows emulator temporary-directory cleanup failure (EPERM). Independently rerunning that unchanged route/emulator test confirmed 30 functional cases passed and the same after-hook failure. Governed validation: 138 workflow tests passed; one unchanged sweep-preview test failed before the app phases, which were run independently.
Deployment: none; integrated staging/browser UAT remains with the recovery coordinator.
