# 2026-11-07 — Repeat staging print warnings on every CPU page

Place staging warnings in repeated table headers and each generated CPU run-sheet page. TIA print output is replaced with a one-page staging-disabled notice; production output is unchanged.

Validation: focused print suite passed (16/16); CPU typecheck passed; CPU production build passed; Chromium generated a 9-page allergen matrix and a 3-page run sheet, with rendered continuation pages visually checked for the warning. Full CPU suite did not finish: the `npm test` workers for `cpu-consumer-invalidation.test.ts` and `cpu-durable-outbox.test.ts` remained active without output; the attempt was stopped, and the suite is not claimed as passing.
Deployment: staging CPU build `build-2026-11-07-002` on merge source `e94f0e1173ca39dc857baead59944eefa7e5662d` predates this follow-up. Follow-up deployment pending.
