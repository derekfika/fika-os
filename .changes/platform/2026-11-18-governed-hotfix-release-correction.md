# 2026-11-18 — Governed hotfix release correction

Hotfix protection evidence now requires the effective required-workflow rule to identify the repository validation workflow. Main reconciliation reads the persisted manifest paths and fails closed if they are missing, empty, or differ in content. Affected boundary: release workflow tooling and hotfix governance.

Complexity: High. Recommended model: Sol. Reason: release eligibility and production lineage safeguards.

Validation: `node --test tools/workflow/release-execution.test.mjs` passed (11 tests); `node --test tools/workflow/hotfix.test.mjs tools/workflow/hotfix-release.test.mjs` passed (17 tests); changelog check and `git diff --check` passed. The first full workflow-suite run had 2 classic-protection fixtures fail because they omitted effective workflow evidence; fixtures were corrected and the 17-test focused rerun passed. Exact-source CI run 44265501054 on `ab67d6f92fb43e8f646d2ec5304362f33c5852e0` passed: `Workflow / merge-gate`, `tooling`, `scope`, and Windows source-workspaces; unrelated app suites skipped.
Deployment: none.
