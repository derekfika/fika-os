# Solo-owner development and releases

The owner directs AI coding agents in ordinary language. Agents handle workspaces, Git, CI, exact source commits and release records. No independent human reviewer, approval comment or owner-supplied SHA is required.

| Owner says | Agent does |
|---|---|
| Implement this | Creates an isolated workspace, implements, tests and prepares integration. No deployment is implied. |
| Integrate it | Integrates the authorised change through a green PR and preserves main history. |
| Put it on staging | Resolves the candidate, deploys only the selected staging app and verifies it. |
| Ship it | Pins a green merged source, deploys only the selected app and verifies it. |
| Roll it back | Selects the verified previous release automatically, performs the authorised selected-app rollback and verifies it. |

A deployment request names an app and environment. A merge alone never starts a rollout. Clarify genuinely ambiguous app/environment scope, not Git mechanics. The agent pins the intended validated source before execution and does not silently include unrelated new changes. The owner need not operate GitHub or copy hashes.

## Development and integration

`origin/main` is the sole integration authority in `C:\Fika\fika-os`. Each task gets a scoped worktree/branch from a recorded main baseline:

```powershell
npm run fika -- workspace create cpu-calendar --owner agent-task
```

The command creates a new task branch and linked worktree from fetched main. Optional `--scope` reports advisory overlap with open PRs. Never overwrite another task’s files or share mutable dependencies, `.next`, environment files or test data. Coordinate shared providers before consumer implementation. Choose an unused port with `fika dev cpu --workspace cpu-calendar --port 13100`.

Run `fika workspace check <task>` for source and advisory overlap. From the task checkout, run `fika affected` and `fika validate`, add unique `.changes/<app>/<change-id>.md` fragments for each affected app, and push the task branch. Shared tooling/platform work uses `.changes/platform/` or root `CHANGELOG.md`. Read-only and documentation-only work have no mandatory entry. Affected app tests, typechecks, builds, shared-contract fan-out and isolated emulator coverage remain enforced by CI.

Use `fika workspace complete <task> --owner <agent-task>` from the canonical checkout to record final Git/PR evidence. The checkout remains in place. Record unpushed or dirty work explicitly with `--preserve --reason`. See [workspace management](workspace-management.md) for historical records, migration and interrupted-operation recovery.

PRs are agent-managed CI/integration tools. Main requires strict `Workflow / merge-gate`, with zero mandatory human approvals and admin-enforced force-push/deletion protection. After CI passes and integration is authorised, the agent can use a merge-commit PR merge pinned to its verified head. GitHub rechecks protected-branch requirements. Do not merge when the owner explicitly said to stop before merging. Squash/rebase merging and automatic branch deletion remain disabled to preserve integrated ancestry and unfinished work.

Use `fika integrate --workspace <task> --pr <number>` to verify the exact head and current main base before merging. If main advances, merge it into the task branch, review the resulting diff and rerun CI.

## Releases

Use the existing authorised local GitHub/gcloud/Firebase login. Hosted GCP workload identity is optional, never a prerequisite for local deployment.

```powershell
fika deploy hospitality --staging
fika deploy hospitality --staging --execute
fika deploy hospitality --prod
fika deploy hospitality --prod --execute
fika rollback hospitality --prod --execute
```

For either environment, the CLI defaults to fetched `origin/main`. Use `--sha` to pin an earlier eligible merge. The exact SHA must be the result of a protected PR merged into main and have a successful GitHub Actions `Workflow / merge-gate` check. Local execution requires a GitHub repository writer and Firebase/GCP credentials for the mapped target. Use `--reason` to add an optional operator note.

The production serving-to-candidate diff is informational. Staging and manual UAT are optional for all change categories, including security, shared contracts and backend changes. A security hotfix follows the same PR, CI, merge and deploy steps. Forward production releases preserve deployed source lineage. Use the explicit rollback command to select an earlier verified release.

Exactly one mapped backend is deployed in region `europe-west4`:

| App | Staging (`fika-os-dev`) | Production (`fika-os`) |
|---|---|---|
| hub | fika-os-staging | fika-os-prod-hub |
| hospitality | fika-hospitality-staging | fika-os-prod-hospitality |
| menu | fika-menu-planning-staging | fika-os-prod-menu |
| cpu | fika-cpu-production-staging | fika-os-prod-cpu |
| delivered-in | fika-delivered-in-staging | fika-os-prod-deliveredin |
| logistics | fika-logistics-staging | fika-os-prod-logistics |
| adhoc | fika-os-staging-adhoc | fika-os-prod-adhoc |
| beverage | fika-beverage-staging | — (staging-only visual preview; no production target) |

Beverage staging is limited to an authenticated, no-write Stage A visual preview. Its separate `fika deploy beverage --staging` target uses the standard exact-main-source and verification gates; do not create a Beverage production target through this mapping. Functional Beverage persistence requires a separately verified staging authority and is not enabled by this preview configuration.

Logistics staging's unauthenticated root intentionally redirects to the staging Hub sign-in with `FIKA_SESSION_MISSING`; its build-info route is authentication-protected. The governed post-rollout probe accepts only an exact HTTP 307 to `https://staging-os.fikacatering.com/` carrying the `logistics` app ID, `FIKA_SESSION_MISSING`, and the exact backend root as `returnTo`. Firebase serving source, READY/SUCCEEDED rollout and 100% traffic remain independently verified. Other app probes and production Logistics probe behavior are unchanged.

Automatic rollouts remain disabled. The CLI verifies target/provenance, submits an exact SHA, waits for READY/SUCCEEDED and 100% serving, and performs non-destructive HTTP smoke. Report app-specific acceptance separately. Migrations, real customer bookings, emails and operational test writes require separate authorisation.

## Rollback and interrupted releases

Rollback selects a verified earlier release record and checks its exact integrated source and CI. Historical records that pinned a PR head can roll back to that head once its PR has merged and the exact commit is in main. Use `--record` to select another verified record from the same target's history. If history has no eligible rollback target, investigate the missing evidence before proceeding.

Append-only `release/staging/<app>` and `release/prod/<app>` ledgers retain historical records. A normal deployment can append a baseline automatically when the ledger is missing or differs from verified Firebase serving state. The recorded previous state comes from the selected backend and its exact build, rollout and traffic. If the serving source cannot be identified, the backend is actively reconciling, or another attempt has an unknown outcome, stop for diagnosis. A pending intent is a technical safeguard against competing submissions. Restore its matching journal before continuing.

`fika deploy <app> --prod --resume --execute` checks the original pinned source and intent against the journal, then verifies Firebase and smoke. A killed process's lock requires inspection. Resume can submit the same intent at most once if the original submission was proven never to have reached Firebase. This requires a 10-minute quiet period, two matching snapshots, no build or rollout created after the intent, quiescent traffic unchanged from the pre-submission state, no relevant operation in flight and no create events in readable Cloud Audit Logs. The candidate must still meet the merged-source CI requirements. The CLI claims the retry in the shared ledger before submission so a second runner cannot submit it. A legacy intent that does not meet those requirements can still be verified. Any ambiguous or active outcome stays pending.

For terminal failures inspect `fika reconcile <app> --prod`, then use `--resolution abandon|complete --rollout <observed-ID> --execute`. Reconciliation requires a returned submitter, positive terminal identity, paginated build/rollout/operation discovery, two stable snapshots and original journal/rollback lineage. The CLI archives the original journal before appending a non-force resolution. Healthy successes must be completed. An abandoned unhealthy release is never a rollback target.

The specialised Hub/Menu serving-baseline and CPU completed-rollout reconciliation commands remain available for explicit record repair. They verify the selected Firebase evidence and append a new ledger entry. Routine deploys can record observed baselines without a separate command.

## Optional hosted runner

Local releases need no new cloud identity. Optional `workflow_dispatch` uses the same CLI and source checks. Pre-credential checks require the exact repository numeric IDs, main ref, release workflow, dispatch event and app/environment. The workflow records the dispatch actor and uses the configured app/environment identity.

Only if hosted execution is wanted, separately authorise environment-scoped `FIKA_GCP_WORKLOAD_IDENTITY_PROVIDER` and `FIKA_GCP_RELEASE_SERVICE_ACCOUNT`. `fika trust <app> --prod|--staging` generates restricted exact-subject/ref/workflow conditions. Use dedicated least-privilege identities and correct issuer/audience, without broad principalSet bindings. Hosted journals persist for 30 days; the agent restores the original artifact for resume/reconciliation and preserves evidence before expiry. Missing hosted identity does not block the local CLI.

## Safe retirement and existing history

Finish/retire only your own completed workspace. `--preserve-generated` moves allowlisted ignored dependencies/build outputs into recovery archives without deleting their contents. `.env`, other unique ignored files, changed HEADs and unpreserved commits block removal. `--archive` separately creates a recovery ref and verified Git bundle for unique clean commits. Ambiguous worktrees, seven existing stashes, recovery archives, rollback refs and unfinished Logistics work remain protected. Bounded cleanup retires only positively redundant unattached local refs after preservation.

CPU lineage baseline: production source `94287ecf98504cc67ba6c09a0de32dcfe8d949da` came from PR #2. Preserve that deployed commit as an ancestor during reconciliation; never squash or cherry-pick away its identity. For each subsequent promotion, compare the actual serving source and release ledger against the candidate rather than relying on this historical SHA. Exact-source CI and runtime verification apply to subsequent deployments.
