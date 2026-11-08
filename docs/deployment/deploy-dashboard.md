# Deploy Control dashboard

One local page shows app assignments and live Firebase status. Its task worktree section reads Git registrations and advisory task metadata. The governed `fika deploy` CLI remains the supported release interface under the [deployment migration criteria](deployment-dashboard.md).

Task worktrees are visible at <http://127.0.0.1:4180/#workspace-management>. See [source workflow and historical migration](workspace-management.md).

## Start it (Windows)

Double-click `Start-Deploy-Dashboard.cmd` in the canonical checkout (`C:\Fika\fika-os`), or run:

```powershell
npm run deploy:dashboard
```

Open <http://127.0.0.1:4180>. Production deploys are **disabled** until you start with the flag:

```powershell
npm run deploy:dashboard -- --enable-production
```

Prerequisites: Node 24, and `firebase login` plus `gcloud auth login` as `derek@fikacatering.com` (the same logins the existing release tooling uses). If Firebase auth has expired the dashboard says so and nothing is written. Change the port with `FIKA_DEPLOY_PORT`.

## What is where

| Piece | Location | Notes |
| --- | --- | --- |
| Config (authority for app ids, project/backend mappings, agent assignments) | `tools/deploy-dashboard/deploy-config.json` | Committed. Holds **no deployed versions**. Schema is enforced by `config.mjs`. |
| Deployment history | `tools/deploy-dashboard/data/deployments.jsonl` | Append-only JSON lines, git-ignored. Audit only; nothing reads it to allow or refuse a deployment. |
| Live status | Firebase App Hosting REST (backend, traffic, rollouts, builds) | Serving build, source commit, rollout state, traffic, last success, in-progress rollouts. |
| Server | `tools/deploy-dashboard/server.mjs` | Node, binds `127.0.0.1` only. |

All worktrees read and write the **canonical checkout's** config and history (resolved through the shared git directory), so an agent working in a worktree updates the same page you are looking at. Override with `FIKA_DEPLOY_CONFIG` / `FIKA_DEPLOY_HISTORY`.

Mappings (verified against Firebase on 2026-10-24; staging is project `fika-os-dev`, production is `fika-os`, region `europe-west4`):

| App | Staging backend | Production backend |
| --- | --- | --- |
| Integration Hub | `fika-os-staging` | `fika-os-prod-hub` |
| CPU Production | `fika-cpu-production-staging` | `fika-os-prod-cpu` |
| Logistics | `fika-logistics-staging` | `fika-os-prod-logistics` |
| Delivered-In | `fika-delivered-in-staging` | `fika-os-prod-deliveredin` |
| Hospitality | `fika-hospitality-staging` | `fika-os-prod-hospitality` |
| Menu Planner | `fika-menu-planning-staging` | `fika-os-prod-menu` |
| Ad-Hoc Production | `fika-os-staging-adhoc` | `fika-os-prod-adhoc` |

A test fails if the six governed apps ever drift from `tools/workflow/policy.mjs`. Ad-Hoc is deliberately not in that file (see the CHANGELOG), so its mapping comes only from this config.

## Agent assignments (advisory)

The dropdown on each row, or the commands below, set `free | luna | sol | sonnet | haiku` plus the branch, an optional task and a timestamp. A second agent can always take over; assignment never blocks, expires or triggers anything.

```powershell
npm run deploy:agent -- start cpu sol --task "calendar fix"     # branch defaults to the current git branch
npm run deploy:agent -- finish cpu
npm run deploy:agent -- status
```

Automatic updates: call `start` when a task begins and `finish` when it ends (agent instructions, or a Claude Code `SessionStart`/`Stop` hook that runs these commands). Hooks are not installed by this change; adding them to `.claude/settings.json` is your decision. Writes replace the file atomically; two agents changing *different* apps in the same instant could in principle lose one update (last writer wins), which is acceptable for advisory data.

Because assignments live in the committed config, changing one makes `deploy-config.json` show as modified in the canonical checkout. If that becomes noisy, move assignments to a git-ignored file; that is a small change to `config.mjs`.

## Deploying

1. **Source SHA** (full 40 characters). "Use origin/main" fills it in. The SHA must exist locally, be on a pushed branch (App Hosting builds from GitHub), contain the app directory, and for production be an ancestor of `origin/main`.
2. **Confirmation.** Staging: one confirm. Production: type `production`, the app id and paste the SHA again.
3. **Preflight, before anything is submitted:** Firebase CLI authenticated and the backend visible; Google Cloud credentials can read it; Firebase reports **no in-progress rollout** and no traffic reconciliation; the SHA is not already serving. Any failure stops with a message and leaves only an audit row.
4. **Submit** exactly `firebase apphosting:rollouts:create <backend> --project <project> --git-commit <sha> --non-interactive --force` (fixed argument list, no shell input from the browser). Output streams to the dialog.
5. **Verify with Firebase, not the exit code:** the new rollout is identified in Firebase, followed to a terminal state, and called **verified** only if it SUCCEEDED, the build is READY, 100% of traffic is on that build and the build's source commit equals the pinned SHA. An HTTP status of the live URL is recorded but is not a gate (these apps redirect to login).
6. History records `submit_started`, `submitted`, then `verified` / `verify_failed` / `verify_timeout` / `unverified`, with the previous serving build/SHA for rollback.

"Dry run" (on by default for production) performs steps 1–3 for real and prints the command without submitting.

The only in-memory state is a per-process guard that stops a double click starting two deployments to one backend from this server; it disappears on restart and Firebase remains the real arbiter. If the server dies mid-deployment, restart it: status comes from Firebase, and retrying is never blocked by anything stored locally.

## Rollback

Every submission records the previous serving build and source SHA. To roll back, deploy that previous SHA through the same dialog (production confirmation applies). Firebase keeps the earlier builds; nothing is deleted. The legacy `fika rollback` and its verified rollback records are untouched and still usable.

## Security model

Loopback only; requests with another `Host` header are refused (DNS-rebinding guard); every write needs a per-start token embedded in the page and a same-origin `Origin`; the browser can only name an app, an environment and a SHA, all validated against the config and a fixed project-per-environment rule (`fika-os-dev` for staging, `fika-os` for production, whatever the config says). Firebase IAM and App Hosting's own rollout concurrency are unchanged.

## Tests

```powershell
npm run test:dashboard
```

## Legacy release wrapper audit and transition plan

### What currently blocks an ordinary deployment (`tools/workflow/releases.mjs`, `recovery.mjs`, `workspaces.mjs`)

| Mechanism | Where | Effect on a routine deploy |
| --- | --- | --- |
| Per app/environment async file lock `release-<app>-<env>.lock` in `<git-common-dir>/fika-workflow` (`asyncLock`) | `releases.mjs` around the whole execute path | A killed process leaves the lock; the next deploy fails with "inspect it, never auto-break locks". |
| Remote **pending release intent** (a commit of kind `intent` on `release/<env>/<app>`) plus local journal `release-<app>-<env>.json` | `releases.mjs` (`appendRecord`, `planRelease`) | While present, any other deploy is refused ("Pending distributed release intent: use --resume"). Stranded by auth failures (fixed), crashes, or a rollout that never started. |
| `--resume` and `reconcile` with authoritative snapshots and audit-log reads | `recovery.mjs` | Preserve the original attempt and recover only when Firebase evidence resolves the outcome. |
| Append-only release ledgers | `releases.mjs` | Preserve verified rollback evidence and serialize submission through a pending intent. Missing or stale baselines can be recorded from independently verified Firebase state. |
| Merged main provenance, exact-source CI and target verification | `releases.mjs`, `policy.mjs` | The supported CLI checks all three in both environments. |

None of these is used by the dashboard. The dashboard's equivalent safety comes from Firebase itself (in-progress rollout check, per-backend serialisation) plus the pinned-SHA and confirmation rules.

### Proposed retirement (each step needs your approval; nothing below has been done)

Any future dashboard deployment integration should invoke the same governed workflow and surface its result. The dashboard remains a status and workspace reference until it meets the [migration criteria](deployment-dashboard.md).

Known gap to decide on: the dashboard's local history is per machine. If deployments are ever run from more than one computer, the Firebase serving state is still correct everywhere, but each machine's "local record" only covers its own deployments.
