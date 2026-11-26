# 2026-11-26 — Isolate Menu Planning test fixture storage

Summary: The rolling-menu test process now uses its own temporary working directory for local catalogue, rolling-menu and publication files. This prevents concurrent test files from reading a partially rewritten shared package-local catalogue. The process restores its original working directory before removing the temporary fixture.

Validation: npm --prefix apps/menu-planning test passed twice (594 tests each: 590 passed, 4 skipped); npm --prefix apps/menu-planning run typecheck passed; git diff --check passed.
Deployment: None.
