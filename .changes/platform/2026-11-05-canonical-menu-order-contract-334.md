# 2026-11-05 Canonical menu presentation order contract (#334)

Date: 2026-11-05
Task: Canonical menu presentation order contract (#334)

- Complexity: High. Recommended model: Sol audit / Luna implementation. Reason: cross-app publication and production-order contract.
- Added explicit resolution from known legacy slots to the 29-slot presentation contract, retaining unknown historical labels after canonical entries.
- Published Menu order version, canonical slot ID/index, and raw legacy slot now survive Hub Production Order materialisation and Logistics Fulfilment Requirement projection. Content changes to canonical order produce a revised projection.
- Validation: focused Hub and CPU contract regressions passed; Menu Planning suite (515 passed, 4 skipped); Menu Planning, Hub, and CPU typechecks passed. Hub full suite had one absent-submodule fixture failure (960 passed, 116 skipped). CPU full suite was stopped after Firestore-bound tests ran without the required in-memory fixture; the six affected tests pass with `FIKA_CPU_PLAN_STORE=memory`. Exact-source CI pending.
- Deployment: not deployed.
