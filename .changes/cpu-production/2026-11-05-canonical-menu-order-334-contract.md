# 2026-11-05 CPU Menu order contract (#334)

Date: 2026-11-05
Task: CPU Menu order contract (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: cross-app production order contract and downstream fulfilment projection.
- CPU production lines now retain versioned canonical Menu slot metadata for downstream parity; source IDs, portions, units, and allergen evidence remain unchanged.
- Validation: focused CPU Menu order regressions (2 passed) and consumer invalidation regressions (6 passed with `FIKA_CPU_PLAN_STORE=memory`); CPU typecheck passed. Exact-source CI pending.
- Deployment: not deployed.
