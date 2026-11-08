# 2026-11-06 — Staging Hub OIDC claim diagnostic

Add a diagnostic-only staging Hub release dispatch that compares GitHub OIDC claims in runner memory and reports presence and equality as PASS/FAIL. The probe uses the release provider audience and compares the subject with the requested, configured, and immutable forms. Diagnostic dispatch skips Google authentication, rollout and artifact upload.

Validation: YAML and Bash syntax, diagnostic isolation, synthetic claim and endpoint-failure cases, and two existing hosted-workflow tests passed. Live main-branch diagnostic dispatch is pending.
Deployment: none.
