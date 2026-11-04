# 2026-11-04 — Resolve CPU shared validation types during staging build

Map the shared production contract's `zod` import to CPU's app-local dependency for TypeScript. This lets the app-only App Hosting install type-check the shared source used by CPU, matching its existing webpack resolution.

Validation: app-only `npm ci`, CPU typecheck and production Next build with no root or shared-package dependencies.
Deployment: none.
