# 2026-11-18 — Governed hotfix release correction

Hotfix protection evidence now requires the effective required-workflow rule to identify the repository validation workflow. Main reconciliation reads the persisted manifest paths and fails closed if they are missing, empty, or differ in content. Affected boundary: release workflow tooling and hotfix governance.

Complexity: High. Recommended model: Sol. Reason: release eligibility and production lineage safeguards.

Validation: `node --test tools/workflow/release-execution.test.mjs` passed (11 tests); `node --test tools/workflow/hotfix.test.mjs tools/workflow/hotfix-release.test.mjs` passed (17 tests); changelog check and `git diff --check` passed. The first full workflow-suite run had 2 stale classic-protection fixtures fail; fixtures were corrected and focused suites rerun. Exact-source CI is pending.
Deployment: none.
