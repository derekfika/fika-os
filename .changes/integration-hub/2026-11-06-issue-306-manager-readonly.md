# 2026-11-06 — Catalogue Manager read-only shell (#306)

Added a company/site Catalogue Manager browse view for services, categories and Items, using the existing catalogue payload and effective service layout. It shows exact category names, record and site-permission counts, URL context, and a link to the existing Item editor. Existing editing tabs remain available. No data contract, write path, or customer-facing catalogue changed.

Validation: focused manager and existing service-layout tests (6 passed), Hub typecheck, focused ESLint, production build, and `git diff --check` passed. Authenticated browser UAT was not run.

Deployment: not deployed; PR candidate only.
