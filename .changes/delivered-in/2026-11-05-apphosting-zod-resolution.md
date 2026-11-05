# 2026-11-05 — Resolve shared schema dependency in App Hosting

App Hosting type-checks shared Delivered-In source outside the app's `node_modules`, so the declared `zod` dependency could not be resolved from `packages/server-shared`. Declare the dependency at the app build root and map the shared source import to that installed package.

Validation: app-only install reproduced the previous Cloud Build failure before the change; Delivered-In tests 209/209, typecheck, and production build passed after the change.
Deployment: not deployed; staging validation is pending.
