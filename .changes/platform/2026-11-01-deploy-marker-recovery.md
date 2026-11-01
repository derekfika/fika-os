# 2026-11-01 — Evidence-based recovery of interrupted deploy markers

Adds `tools/workflow/deploy-marker-recovery.mjs` (standalone entrypoint) and an exported
`recoverDeployOperation` in `workspace-admin.mjs`. An administrator can archive a stranded `deploy`
workspace-operation marker only when its pid is dead, its lease matches the registry, no release lock or
non-completed journal exists for any app/environment, no ledger head is an intent, and every release
intent committed within 120s of the marker start has a later terminal record (deploy, rollback or
abandoned) with the same releaseId. Preview-first with an approve-hash covering every intent/terminal
pair; execution writes an fsynced audit record (resumes append an entry) and moves the marker to an
archive, changing nothing else (no lease, registry, ledger or journal). `cli.mjs` wiring and recording
app/env/releaseId in future markers are documented follow-ups. See `docs/deployment/deploy-marker-recovery.md`.

Validation: new hermetic `deploy-marker-recovery.test.mjs`; existing workflow tests; workspace and changelog checks.
Deployment: none; no marker has been recovered.
