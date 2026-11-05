# 2026-11-05 Canonical menu presentation order contract (#334)

Date: 2026-11-05
Task: Canonical menu presentation order contract (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: cross-app publication and production-order contract.
- Added explicit resolution from known legacy slots to the 29-slot presentation contract, retaining unknown historical labels after canonical entries.
- Validation: shared ordering regressions and full Menu Planning suite (515 passed, 4 skipped); Menu Planning typecheck/build passed. Exact-source CI pending.
- Deployment: not deployed.
