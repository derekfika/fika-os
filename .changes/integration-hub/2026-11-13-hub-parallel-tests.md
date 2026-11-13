# 2026-11-13 — Isolate and parallelise Hub unit tests

Hub unit tests now run in four process-isolated workers. Firestore emulator tests remain sequential. Updated the workflow regression guard to require process isolation and keep the emulator job separate.

Validation: baseline CI history shows sequential Hub unit tests at 102–133s. Local full suite: 1,199 cases (1,075 passed, 124 emulator-only skipped), three concurrency-4 runs passed at 50.7–52.6s; concurrency 2 passed at 93.3s. Focused config guard, Hub typecheck and production build passed. Exact-source CI pending.
Deployment: none.
