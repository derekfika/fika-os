# 2026-11-01 — Wire the Development dashboard GitHub token into Hub staging

Adds the runtime secret reference `FIKA_DEV_DASHBOARD_GITHUB_TOKEN` to `apphosting.staging.yaml` so the owner-only Development dashboard can read GitHub issues, PRs and checks server-side on staging. Staging only; production config is untouched and the secret value is never in the repository.

Validation: YAML parses and matches the existing secret entries; governed scope check. Deployment: Hub staging redeploy requested separately.
