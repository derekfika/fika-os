# 2026-11-13 — Parallel Menu Planning CI validation

The affected-application workflow skips the unnecessary root dependency install for Menu Planning and uses its app lockfile for npm caching. A required Menu Planning validation lane runs typecheck and an exact-source production build alongside the unchanged test lane; the protected merge gate requires both lanes when Menu Planning is affected.

Validation: app-only install, 562-case test suite, typecheck, production build, workflow routing guard, workspace check and changelog check passed locally. Exact-source GitHub Actions validation pending.

Deployment: none.
