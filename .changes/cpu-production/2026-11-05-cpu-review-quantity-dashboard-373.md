# 2026-11-05 CPU dashboard review and quantity visibility (#373)

Date: 2026-11-05
Task: CPU dashboard review and quantity visibility (#373)

- Complexity: Medium. Recommended model: Luna. Reason: scoped CPU UI/presentation correction using existing canonical order state.
- Draft orders with an amended workflow are surfaced as needing review. Missing production quantities are counted and labelled without substituting customer portions; withdrawn orders are not counted as active missing-quantity work. Order detail separates customer-ordered lines from explicitly recorded production quantities.
- Style Guide compliance: PASS. Reused existing CPU status and attention patterns; no new visual system or domain mutations.
- Validation: focused presentation tests (8 passed); CPU typecheck passed; production build passed. Full CPU suite was stopped after stalling at `cpu-consumer-invalidation.test.ts` with no output for over one minute. Governed `fika validate` was also stopped after its workflow test fixture stalled in workspace creation. Exact-source CI pending.
- Deployment: not deployed.
