# 2026-11-13 — Isolate and parallelise Hub unit tests

Hub unit tests now run in four workers, retaining Node's default separate-process isolation. The shared Firestore emulator suite remains sequential. Hub unit tests run alongside a separate validation lane that performs the exact-source production build and typecheck concurrently; the merge gate requires both lanes.

Validation: 10-run baseline Hub unit step median 112s (range 102–133s); exact-source run 43505231652 on SHA `04aaea0402ee7fcb20dbc68e598ff9f8bff4407a` passed with unit tests in 66s, validation lane in 87s, and all 1,199 test cases (1,075 passed, 124 emulator-only skipped). Four local concurrency-4 runs passed in 50.7–53.9s; one concurrency-2 run passed in 93.3s. No test cases removed and no coverage gaps introduced. Deployment: none.
