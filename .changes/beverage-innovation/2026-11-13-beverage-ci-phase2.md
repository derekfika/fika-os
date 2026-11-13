# 2026-11-13 — Preserve Beverage checks with a leaner install

The Beverage CI routing guard verifies the full isolated unit suite, its separate Firestore emulator script, app-only dependency install, typecheck, exact-source production build and protected merge gate. Staging remains a no-write visual preview; this change does not enable functional persistence or production hosting.

Validation: app-only npm ci without root dependencies, 44 existing unit cases, typecheck, production build and focused CI routing tests passed locally. The emulator script remains separate from required validate.yml and was not run.

Deployment: none.
