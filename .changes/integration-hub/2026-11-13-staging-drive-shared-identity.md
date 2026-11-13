# 2026-11-13 — Isolate staging Drive identity

Bind the Hub staging Drive paths to the dedicated keyless service account and Shared Drive, remove staging DWD and legacy production-owner backend overrides, and keep customer email delivery disabled.

Validation: focused App Hosting config test passed; governed `fika validate` passed, including Hub tests (1,075 passed, 124 skipped), typecheck and production build.
Deployment: staging only, pending governed release; production unchanged.
