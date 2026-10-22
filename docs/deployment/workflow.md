# Governed development and selected-app releases

Implemented 22 October 2026. Application data, authentication, schedulers and automatic-rollout settings are outside this tooling's mutation scope.

## Daily development

Use the shared Git object store at `C:\Fika\fika-os`, not another clone. Each task owns a separate worktree, branch and scope lease:

```powershell
npm run fika -- workspace create cpu-calendar --owner codex-task-123 --scope apps/cpu-production
```

The command fetches `origin/main`, records its exact baseline, allocates ports and creates `codex/cpu-calendar` under `C:\Fika\agent-workspaces\fika-os`. It rejects overlapping active leases and reused names. Shared-package work must lease the relevant `packages/...` or `apps/shared/...` paths and coordinate provider/consumer integration. Existing legacy worktrees do not have leases: confirm ownership before touching their scope. Never write in another task's workspace.

In the returned directory, install root and affected-app dependencies separately. Do not share `node_modules`, `.next`, environment files or mutable test data. `fika dev cpu --workspace cpu-calendar --owner codex-task-123` uses its allocated port. The local supervisor's fixed-port, restored-dataset workflow remains available for a single exclusive whole-platform session; do not run concurrent supervisors or import its data into task tests.

```powershell
npm run fika -- workspace check cpu-calendar --owner codex-task-123
npm run fika -- affected --base origin/main
npm run fika -- validate --base origin/main --plan
npm run fika -- validate --base origin/main
```

`workspace check` includes committed, staged, unstaged and untracked paths. Only the root CHANGELOG is shared bookkeeping. `validate` runs workflow safety tests and affected applications' existing test/typecheck/build scripts. Shared dependencies conservatively select all six consumers. CPU tests retain `FIKA_CPU_PLAN_STORE=memory`; isolated tests use a demo project. Read the app's AGENTS and Style Guide before implementation. Do not silently waive existing test failures.

Commit scoped changes and CHANGELOG, push the task branch and open a PR to main. CI always reports `Workflow / merge-gate`, including intentional application-job skips. App jobs validate the exact source commit. Hub changes additionally run the existing booking-cutoff POST-route regression in an isolated Firestore emulator. Main requires an up-to-date passing gate and one independent PR approval; force pushes and deletion are disabled, including for administrators.

Only main integrates development. Use merge-commit PR integration: repository squash/rebase merge options are disabled so reviewed/staged commits remain ancestors of main. Automatic branch deletion is disabled; retire through the guarded lifecycle. Do not merge unfinished sibling branches to make a release work. For a staging-only candidate, first separate its changes into a fresh task branch from current main, or deliberately cherry-pick only approved commits into such a branch. Resolve and validate actual overlaps, then PR that source into main. Production requires its source to be integrated into main.

## Release records and target map

| App | Staging backend (`fika-os-dev`) | Production backend (`fika-os`) |
|---|---|---|
| hub | fika-os-staging | fika-os-prod-hub |
| hospitality | fika-hospitality-staging | fika-os-prod-hospitality |
| menu | fika-menu-planning-staging | fika-os-prod-menu |
| cpu | fika-cpu-production-staging | fika-os-prod-cpu |
| delivered-in | fika-delivered-in-staging | fika-os-prod-deliveredin |
| logistics | fika-logistics-staging | fika-os-prod-logistics |

Every app has `release/staging/<app>` and `release/prod/<app>` in region `europe-west4`. These are append-only **release ledger branches**, each containing `release.json`, not application source trees. `release.json.sourceSha` is the controlled pointer. A ledger commit links its previous ledger and source commit as parents, keeping history and sources reachable without force-updating branches. NEVER checkout/deploy a ledger SHA as application code. Firebase automatic rollouts stay disabled; the tool uses a single explicit backend and exact source SHA.

Initial ledgers capture observed READY/SUCCEEDED, 100%-serving builds without redeployment. Sources outside main are marked historical exceptions. In particular, CPU production `94287ecf98504cc67ba6c09a0de32dcfe8d949da` is the open PR #2 source and is not integrated into main. Staging CPU still serves `9f7115245f2fe77140f9d7c0b918834f9a306045`; a successful old staging rollout does not prove PR #2 was staged. Reconcile/review that production lineage before a new CPU promotion; do not overwrite it with older main code. Preserved Logistics commits `4e66d152`/`5a29af83` remain separate unfinished work.

## Approval and release lanes

Every execution requires an actual repository-owner approval comment on a repository issue/PR, tied to the exact target and source. Never manufacture approval from a routine implementation request. The first line is:

```text
/fika-approve cpu prod <40-character-source-sha> standard <expiry-UTC-ISO>
```

Expiry must be in the future and at most seven days after comment creation. Use the comment URL, including `#issuecomment-...`. An approval for another app, environment or SHA is invalid. Production approval remains explicit even after a PR is merged.

- **Fast:** cosmetic CSS/assets/docs; JSX presentation changes additionally require owner `Risk: cosmetic-only` attestation and UI-only paths. Exact-source CI and main integration still apply. Operational, shared, backend and configuration changes cannot use this lane.
- **Standard:** exact-source CI, a verified staging record with the same selected-app/dependency tree, main integration, and an independent trusted approval on the exact source PR head.
- **Owner exception:** `owner-exception` plus a second line `Reason: ...` can replace the independent release review when unavailable. It does not replace CI, staging, main integration, target safety or GitHub's required main PR approval. A missing reviewer is an explicit handoff blocker, never an indefinite silent wait. If owner and all agents share one GitHub identity, a separate trusted collaborator must approve the main PR, or the human owner must separately authorise and document a repository-administration exception. Agents must not disable protection to self-approve.

## Deploy exactly one application

Prerequisites: clean task workspace, Git, Node 22.13+, GitHub CLI with repository access, Firebase CLI 15.30.2+, and an authorised gcloud login with the existing deployment permissions. No secret is stored in source or printed. Windows uses `fika.cmd`; PowerShell can always use `npm run fika --` or `node tools/workflow/cli.mjs`.

```powershell
fika deploy cpu --staging --sha <full-source-sha>
fika deploy cpu --staging --sha <full-source-sha> --execute --approval-url <owner-comment-url>
fika deploy cpu --prod --sha <full-integrated-source-sha>
fika deploy cpu --prod --sha <full-integrated-source-sha> --execute --approval-url <owner-comment-url>
```

Without `--execute`, inspection/dry-run changes neither traffic nor release pointers. A dry-run is not deployment approval: execute additionally enforces CI/review/approval/staging gates. The CLI verifies project/backend mapping, disabled automatic rollouts, quiescent 100% serving state, existing release provenance and preservation of the current production source. One app release never submits another backend. `scripts/deploy-staging-apphosting.ps1` is a compatibility adapter to the same gates, not a bypass.

Before submission, an append-only remote pending intent claims the target and a local journal records its plan and known-good rollback source. Normal non-force pushes reject a competing stale writer before it can deploy. Local locks also serialize same-machine operations. Then the CLI submits one rollout, waits for READY/SUCCEEDED and 100% traffic at the exact SHA, performs a non-mutating root HTTP smoke, and appends the verified serving record. Authenticated app-specific acceptance remains required; a root HTTP 200 is not business UAT.

An uncertain submission, failed build or failed smoke leaves the intent and journal pending. Never blindly retry Firebase or overwrite the ledger. Diagnose first, then:

```powershell
fika deploy cpu --staging --sha <original-sha> --execute --approval-url <original-comment> --resume
```

Resume only verifies the original intent; it does not resubmit. If no rollout exists or a failed rollout cannot recover, an operator must review the journal/platform state and explicitly reconcile that intent before a newly approved attempt. Locks left by a killed process likewise require inspection, not automatic deletion.

## Rollback

Read the selected app's ledger history and choose a verified `baseline`, `deploy` or `rollback` record. Pending intents are never known-good targets. Rollback uses the exact historical app/dependency scope hash, explicit fresh owner approval and one backend:

```powershell
fika rollback cpu --prod --record <verified-ledger-commit> --sha <that-record-source-sha>
fika rollback cpu --prod --record <verified-ledger-commit> --sha <that-record-source-sha> --execute --approval-url <owner-comment-url>
```

A historical verified record may predate CI; this narrow rollback exception is recorded rather than fabricating a passing check. It does not rewrite source or ledger history. Check cross-app compatibility before rollback, and never migrate/revert business data automatically. The previous good source remains in every successful release record and journal.

## GitHub-hosted releases

The selected-application `workflow_dispatch` uses the same CLI, explicit SHA, app/environment concurrency group and environment review. Production environments require the owner reviewer. Actions are pinned to immutable commits. The workflow fails before rollout if either reviewed environment variable is absent:

- `FIKA_GCP_WORKLOAD_IDENTITY_PROVIDER`
- `FIKA_GCP_RELEASE_SERVICE_ACCOUNT`

Provisioning a least-privilege GCP workload identity is a separate IAM decision; this task does not change production IAM. Existing authorised local `fika deploy` works independently. Hosted jobs retain the non-secret plan journal artifact for 30 days. Supply `resume_run_id` with the original app/environment/SHA/approval to restore it; remote intent and plan identity must still match. Missing artifacts fail closed. Download a pending journal before retention expires if recovery takes longer. Never upload credentials or whole `.git` directories.

## Finish and guarded cleanup

```powershell
fika workspace finish cpu-calendar --owner codex-task-123
fika workspace retire cpu-calendar --owner codex-task-123
fika cleanup --output <external-plan.json>
fika cleanup --execute --file <external-plan.json> --approve-hash <reported-planHash>
```

Finish refuses dirty work. Retire refuses untracked/ignored files (including dependency/runtime files), changed finished HEADs and unique commits. Preserve needed files first; `--archive` explicitly preserves unique clean commits in a recovery ref and verified Git bundle before removing the owned workspace. Never force-remove another agent's worktree.

Cleanup is bounded to eight unattached, fully integrated temporary local branch refs per exact fresh plan. Open-PR heads, attached branches, unique commits, main, integration/release/recovery namespaces, stashes and archives are protected. Every removed local branch first receives a recovery ref. Remote branch deletion is not automated. `git remote prune origin` removes only already-deleted remote tracking refs after inspection; it does not delete remote branches. Age alone is never a retention decision.

The initial protected inventory and deployment/cleanup evidence are outside the repository under `C:\Users\derek\Documents\FIKA OS Migration Evidence\Workflow-Modernisation-2026-10-22`. All seven pre-existing stashes, dirty/ambiguous legacy worktrees, recovery archives and preserved Logistics history remain protected. These Git safeguards coordinate cooperative agents; shared owner credentials are not a security boundary against a malicious administrator.
