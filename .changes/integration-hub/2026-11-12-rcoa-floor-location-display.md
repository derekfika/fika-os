# 2026-11-12 — RCoA floor and location propagation

Hub now validates new RCoA room selections and booking amendments against the governed floor directory. CPU production destination labels, quote PDFs and stable Calendar event contents include the RCoA floor and room together; other site displays retain their current behavior.

Validation: focused Hub RCoA ingestion, amendment, CPU destination, quote and Calendar regressions passed (113 passed / 29 environment-gated skips); Hub full suite 1,055 passed / 122 skipped with one unrelated missing `fika-platform-specs` fixture failure in `address-workflow.test.ts`; `npx tsc --noEmit` and production build passed. ESLint could not start because this app has no ESLint 9 flat config. Staging UAT pending.
Deployment: not deployed; staging requested.
