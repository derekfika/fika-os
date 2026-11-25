# 2026-11-25 — Finish reading local PDF bytes before cleanup

CPU waits for the local renderer's PDF bytes before removing the temporary file. This fixes intermittent missing-file errors during local rendering and emulator tests.

Validation: The regression test failed against the original implementation and passed with the fix. All 56 focused checks passed. The full CPU suite passed with 697 tests and six skips. CPU typecheck and production build passed.

Deployment: none.
