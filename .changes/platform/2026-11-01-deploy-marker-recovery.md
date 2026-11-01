# 2026-11-01 — Evidence-based recovery of interrupted deploy markers

Adds `tools/workflow/deploy-marker-recovery.mjs` (standalone entrypoint) and an exported
`recoverDeployOperation` in `workspace-admin.mjs`. An administrator can archive a stranded `deploy`
workspace-operation marker only when its pid is dead, its lease matches the registry, and read-only
release-ledger evidence shows its single intent was superseded by a later completed deploy of the same
app/environment, with no live release lock or pending journal. Preview-first with an approve-hash;
execution writes an audit record and moves the marker to an archive, changing nothing else (no lease,
registry, ledger or journal). `cli.mjs` wiring is a documented follow-up. See
`docs/deployment/deploy-marker-recovery.md`.

Validation: new hermetic `deploy-marker-recovery.test.mjs`; existing workflow tests; workspace and changelog checks.
Deployment: none; no marker has been recovered.
