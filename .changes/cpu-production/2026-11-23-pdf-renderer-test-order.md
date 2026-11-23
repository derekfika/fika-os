# 2026-11-23 — Align emulator PDF renderer selection

The CPU emulator now chooses its local PDF renderer in the same order as the application. On this Windows host, Edge exited successfully without writing the requested PDF, while Chrome generated a valid artifact; the test previously forced Edge first and reported a misleading ENOENT.

Validation: CPU Firestore emulator suite passed 32/32; hosted PDF renderer contract tests passed 4/4. No runtime application code changed.
Deployment: none; test harness only.
