# 2026-11-05 CPU Menu run sheet canonical order (#334)

Date: 2026-11-05
Task: CPU Menu run sheet canonical order (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: production-facing cross-app menu order consumer and printable operational evidence.
- CPU Menu run sheets now use the shared versioned slot contract on screen and in A4 output, with boxed populated sections, actual slot labels, deterministic legacy fallback, and stable ordering for non-Menu orders.
- Site/date selection, latest active revision filtering, customer quantities/units, paper-only checkboxes, pagination, and handover fields remain intact.
- Validation: run-sheet and print regressions (17 passed), CPU typecheck and production build passed. Exact-source CI and authenticated screen/print UAT pending.
- Style Guide compliance: PASS. Reused the existing light CPU surface and semantic FIKA tokens; print uses the existing monochrome A4 design.
- Deployment: not deployed.
