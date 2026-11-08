# Deployment Dashboard — status and migration criteria

**6 November 2026 workflow update:** the dashboard shows local Git task worktrees and advisory task details. The previous workspace registry is historical evidence. Governed `fika deploy` remains the release interface. See [workspace management](workspace-management.md). The historical evidence below describes the earlier 24 October checkout.

**Historical status checked against `origin/main` at `540b565b8f0cc1d58e8e768d85e4e66aa0cb2596` on 24 October 2026:** the proposed local HTML Deployment Dashboard is **not verified as an operational deployment interface**. Keep the governed deployment CLI and its release safeguards as the routine interface until the conditions in this note are met.

This note records current repository evidence and the eventual dashboard requirements. It does not authorize or perform a deployment.

## Implementation and historical evidence

The repository now includes a [local Deploy Control dashboard](deploy-dashboard.md) with Firebase status and task-worktree inventory. Its prototype runner has a separate execution path and has not passed the migration criteria below. The supported CLI maps seven apps across staging and production, including Ad-Hoc. See the [target table](workflow.md#releases).

The 24 October 2026 checkout had no reviewable dashboard runner. Its local JSONL recorded an Ad-Hoc staging submission and a failed verification for build `build-2026-10-24-004`. That record remains historical evidence.

## Supported deployment path today

Use the existing governed command interface described in [the solo-owner operator guide](workflow.md), for example:

```powershell
npm run fika -- deploy menu --staging
npm run fika -- deploy menu --staging --execute
npm run fika -- deploy menu --prod
npm run fika -- deploy menu --prod --execute
```

The first invocation is a dry-run. Both environments require an exact protected main merge with successful CI and authenticated access to the mapped backend. Staging and manual UAT are optional. The CLI remains the single supported route; do not bypass it with independent Firebase rollout commands. The dashboard must call the same governed release mechanism if it is later approved, not recreate or weaken its checks.

## Required dashboard behavior before migration

### Coverage and deployment safeguards

1. Represent all seven applications and fourteen separate environment targets. Use the governed target mapping and verify backend access in each environment.
2. Bind every action to one application, one environment, and a full source SHA. Keep dry-run/preflight, CI and merged-source provenance, authenticated access, rollback target, Firebase submission state and retry/reconciliation behavior equivalent to the governed CLI.
3. Read Firebase App Hosting for actual serving state. Do not interpret a command exit code, local record, branch label, submitted rollout or HTTP 200 as a successful live release. If submission outcome is uncertain, inspect Firebase build/rollout/operation history before any retry.
4. Display a clear failure state. Never fabricate success, retry an uncertain submission, erase release history, or create a blocking custom deployment lock/lease/mutex. Firebase rollout and operation status remain the authority for active deployment state.
5. Keep existing Git/PR safeguards and the repository's governed workspace ownership for code work. Dashboard agent assignment is informational and must not create a new deployment gate or replace the source-workspace workflow.

### Required version and assignment fields

For each app, show staging and production together, each with:

- **Application version:** read the checked-in app package manifest where a meaningful version is maintained; otherwise show `Unversioned`. At this audit, six apps show `0.1.0` and Logistics has no version value in its app package metadata. These package versions are metadata, not the deployed source identity.
- **Git source SHA:** full SHA from the Firebase App Hosting build's source metadata for the serving rollout. A shortened SHA may be displayed beside it, but retain a way to inspect/copy the full SHA.
- **Firebase serving build/rollout ID:** identify the currently serving Firebase App Hosting rollout/build, not merely the most recently submitted one.
- **Deployment time and status:** use Firebase's serving rollout/build timestamps and terminal/current state. Distinguish pending, failed, succeeded/serving and unknown states.
- **Agent assignment:** the selected informational value from the dashboard's documented local configuration, plus the associated app/branch/task if supported. Allowed values are `free`, `luna`, `sol`, `sonnet`, `haiku`. Respect manual override and return to `free` when finished. Until a checked-in or otherwise reviewable configuration and update command exist, do not invent a field, command or assignment.

Keep local intent/history metadata separate from verified Firebase state. If they disagree, show both values and use the governed CLI's independently verified serving state. Never replace a missing version with an arbitrary number, a branch name, or a presumed deployed SHA.

## Verification gate for changing the standard interface

Before root instructions designate the dashboard as the standard release interface, a reviewer must verify:

- Its documented local location and startup command work from a clean supported environment.
- The actual HTML/JS and backend runner source are available for review, including how it obtains credentials and invokes the governed deployment mechanism.
- All seven app records, fourteen targets, package-version rules and local assignment configuration are present and validated; Ad-Hoc target mappings are confirmed rather than inferred.
- Staging actions deploy only the selected staging backend; production actions use the same source, authentication and rollout checks as the CLI.
- Firebase serving version is read and displayed independently of local intent/history; mismatches, failures and uncertain submissions fail closed.
- Existing CI, rollback, exact-SHA and release-history safeguards remain intact; the dashboard creates no custom blocking locks.
- A harmless staging-only deployment through the dashboard completes, then Firebase independently confirms exact source SHA, build/rollout ID, timestamp, status and health. No production deployment is part of this verification gate.

Until all items pass, keep the CLI workflow as documented in `docs/deployment/workflow.md`. Do not remove or weaken that procedure based on a prototype or failed attempt. This note should be updated with verified evidence before the dashboard is promoted.
