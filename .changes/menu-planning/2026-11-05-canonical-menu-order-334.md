# 2026-11-05 Brian canonical menu order publication contract (#334)

Date: 2026-11-05
Task: Brian canonical menu order publication contract (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: cross-app publication and production-order contract.
- New weeks now receive the versioned 29-slot canonical template; legacy weeks retain their saved template and legacy slot labels.
- New publication revisions carry canonical slot order metadata while retaining source entry IDs, raw slot values, quantities, destinations, and allergen evidence. Historical snapshots are not rewritten.
- Validation: focused menu, category, and shared ordering regressions (58 passed); full Menu Planning suite (515 passed, 4 skipped); typecheck and production build passed. Exact-source CI pending.
- Deployment: not deployed.
