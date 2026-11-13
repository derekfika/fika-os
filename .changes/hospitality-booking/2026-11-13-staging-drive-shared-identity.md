# 2026-11-13 — Isolate Hospitality staging Drive

Bind staging matrix and quote Drive paths to the dedicated keyless service account and approved Shared Drive; remove staging DWD and production-owner bindings while keeping email and Calendar delivery disabled.

Validation: focused Hospitality config test passed; governed `fika validate` passed, including Hospitality tests (474 passed), typecheck and production build.
Deployment: staging only, pending governed release; production unchanged.
