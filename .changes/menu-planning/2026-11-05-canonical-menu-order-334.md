# 2026-11-05 Brian canonical menu order publication contract (#334)

Date: 2026-11-05
Task: Brian canonical menu order publication contract (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: cross-app publication and production-order contract.
- New weeks now receive the versioned 29-slot canonical template; legacy weeks retain their saved template and legacy slot labels.
- New publication revisions carry canonical slot order metadata while retaining source entry IDs, raw slot values, quantities, destinations, and allergen evidence. Historical snapshots are not rewritten.
- Canonical slot metadata now continues through Hub production materialisation, CPU order types, and Logistics fulfilment projections; amendments compare the metadata as part of the projected content.
- Validation: focused menu/Hub/CPU contract regressions passed; full Menu Planning suite (515 passed, 4 skipped); Menu Planning, Hub, and CPU typechecks passed. Full Hub suite: 960 passed, 116 skipped, one missing-submodule fixture failure. Full CPU suite was stopped after tests attempted Firestore without its in-memory outbox fixture; the six affected consumer-invalidation tests pass with `FIKA_CPU_PLAN_STORE=memory`. Exact-source CI pending.
- Deployment: not deployed.
