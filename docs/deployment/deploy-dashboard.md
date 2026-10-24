# Deploy Control dashboard

One local page that shows who is assigned to each app, what Firebase is actually serving in staging and production, and deploys an approved commit. It adds **no locks, leases, expiries, pending intents or persistent mutexes**, and it does not touch the governed development workflow (`fika workspace …`) or the legacy `fika deploy` release wrapper.

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
| `--resume`, `reconcile` (abandon/complete) with two stable snapshots, audit-log reads and owner approval | `recovery.mjs` | Needed to clear a stranded intent; slow and can itself be refused when evidence is ambiguous. |
| Release ledger branches (12 append-only `release/{staging,prod}/<app>`) and "live serving must equal ledger" check | `releases.mjs` | A deploy made any other way makes the next governed deploy fail until reconciled. |
| Lane/lineage gates (exact-source CI, staging evidence, scope hash, integrated-into-main, owner-approved) | `releases.mjs`, `policy.mjs` | Policy, not a lock. Intentionally **kept for production decisions**; the dashboard enforces its own smaller checks only. |
| Workspace leases (`workspaces/<name>.json`, overlapping-scope rejection, no name reuse) | `workspaces.mjs` | Governs development, not deployment. **Not changed here.** |

None of these is used by the dashboard. The dashboard's equivalent safety comes from Firebase itself (in-progress rollout check, per-backend serialisation) plus the pinned-SHA and confirmation rules.

### Proposed retirement (each step needs your approval; nothing below has been done)

1. **Run in parallel (now).** Use the dashboard for staging. Keep `fika deploy` available. Nothing is deleted or migrated.
2. **Stop creating new intents and locks on the routine path.** Change `fika deploy` so that, for staging, it delegates to the same runner as the dashboard (Firebase-derived conflict check, verified result, append-only history) and does not take `release-<app>-<env>.lock` or write an `intent` commit. This is the change that removes stranded-intent failures. It edits `tools/workflow`, so it needs a governed workspace and your sign-off.
3. **Production.** After a period of clean staging use, route production the same way, keeping explicit owner confirmation and the integrated-into-`main` rule. Decide whether you still want staging-evidence and lane gates for production; if so keep them as a *pre-check*, not as persisted state.
4. **Existing state: preserve, don't migrate.** Leave the `release/*` ledgers, journals, rollback records and the one pending Hub staging intent exactly as they are. They remain valid rollback evidence and `fika reconcile` keeps working for them. Add a read-only "legacy records" view later if wanted. Do not delete or rewrite them, and do not resolve that pending intent without a separate decision.
5. **Retire the lock/intent code only after** a defined quiet period with no pending intents anywhere, a verified export of the ledgers, and your explicit go-ahead. Until then the code stays dormant.
6. **Unchanged throughout:** workspace leases and the development workflow, Firebase permissions, automatic-rollout-disabled policy, rollback capability.

Known gap to decide on: the dashboard's local history is per machine. If deployments are ever run from more than one computer, the Firebase serving state is still correct everywhere, but each machine's "local record" only covers its own deployments.
