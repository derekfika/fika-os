# 2026-11-16 — Verify App Hosting's nested effective environment

Read the deployed build's effective runtime variables from `Build.config.effectiveEnv`, matching the App Hosting API response. The configuration-only plan now compares the active serving value and the post-rollout value at the documented path, so stale runtime configuration requires a rollout and a verified current value can remain a no-op.

Validation: release execution regression tests use the API's nested build configuration shape; CLI parser test, changelog validation and workflow gate pending.
Deployment: none. Read-only production preview only; no runtime config or Calendar state changed.
