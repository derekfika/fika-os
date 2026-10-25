# Solo-owner development and releases

The owner directs AI coding agents in ordinary language. Agents handle workspaces, Git, CI, exact source commits and release records. No independent human reviewer, approval comment or owner-supplied SHA is required.

| Owner says | Agent does |
|---|---|
| Implement this | Creates an isolated workspace, implements, tests and prepares integration. No deployment is implied. |
| Integrate it | Integrates the authorised change through a green PR and preserves main history. |
| Put it on staging | Resolves the candidate, deploys only the selected staging app and verifies it. |
| Ship it | Records explicit production authorisation, checks the full change and staging requirements, deploys only the selected app and verifies it. |
| Roll it back | Selects the verified previous release automatically, performs the authorised selected-app rollback and verifies it. |

An ordinary coding request never authorises production. Clarify genuinely ambiguous app/environment scope, not Git mechanics. The agent pins the intended validated source before execution and does not silently include unrelated new changes. The owner need not operate GitHub or copy hashes.

## Development and integration

`origin/main` is the sole integration authority in `C:\Fika\fika-os`. Each task gets a scoped worktree/branch from a recorded main baseline:

```powershell
npm run fika -- workspace create cpu-calendar --owner agent-task --scope apps/cpu-production
```

The command allocates isolated paths/ports and rejects overlapping active leases and reused names. Never create another clone, overwrite another task's files or share mutable dependencies, `.next`, environment files or test data. Coordinate shared providers/contracts before consumer implementation. `fika dev cpu --workspace cpu-calendar --owner agent-task` uses its allocated port; the fixed-port whole-platform supervisor requires exclusive ownership.

Run `fika workspace check`, `fika affected` and `fika validate`, update CHANGELOG, and push the task branch. Existing affected-app tests/typechecks/builds, shared-contract fan-out, CPU memory-store configuration and the relevant isolated Hub emulator regression remain enforced by CI.

PRs are agent-managed CI/integration tools. Main requires strict `Workflow / merge-gate`, with zero mandatory human approvals and admin-enforced force-push/deletion protection. After CI passes and integration is authorised, the agent can use a merge-commit PR merge pinned to its verified head. GitHub rechecks protected-branch requirements. Do not merge when the owner explicitly said to stop before merging. Squash/rebase merging and automatic branch deletion remain disabled to preserve staged ancestry and unfinished work.

## Releases

Use the existing authorised local GitHub/gcloud/Firebase login. Hosted GCP workload identity is optional, never a prerequisite for local deployment.

```powershell
fika deploy hospitality --staging
fika deploy hospitality --staging --execute
fika deploy hospitality --prod
fika deploy hospitality --prod --execute --owner-approved --reason "Ship the validated Hospitality change"
fika rollback hospitality --prod --execute --owner-approved --reason "Roll Hospitality back"
```

These are internal agent commands. The agent sets `--owner-approved` only after an actual owner production instruction and records that instruction verbatim or with a faithful scoped summary. Authenticated production execution must be by the solo owner. Authorisation is bound to app, environment, action and resolved source in the existing journal/ledger; there is no approval registry, GitHub comment or reviewer exception.

Staging defaults to the task workspace's committed HEAD; production defaults to fetched main. The agent can internally pin `--sha` to the intended candidate. Production source must be integrated, exact-source CI must pass, the workspace must be clean and deployed lineage must be preserved. The complete Git delta from actual serving source to candidate determines release treatment, including intervening PRs:

- Cosmetic CSS/assets/docs can use the fast CI-to-production path after explicit owner release authorisation. Reviewed rendering-only JSX can use agent `--cosmetic-only`; operational/backend/shared changes cannot be forced through it.
- Operational, pricing, quantities, allergens, permissions, shared contracts and other data-sensitive changes require verified staging of the same app/dependency tree. `--standard` deliberately requires staging when uncertain. Owner approval never bypasses this check.

Exactly one mapped backend is deployed in region `europe-west4`:

| App | Staging (`fika-os-dev`) | Production (`fika-os`) |
|---|---|---|
| hub | fika-os-staging | fika-os-prod-hub |
| hospitality | fika-hospitality-staging | fika-os-prod-hospitality |
| menu | fika-menu-planning-staging | fika-os-prod-menu |
| cpu | fika-cpu-production-staging | fika-os-prod-cpu |
| delivered-in | fika-delivered-in-staging | fika-os-prod-deliveredin |
| logistics | fika-logistics-staging | fika-os-prod-logistics |

Automatic rollouts remain disabled. The CLI verifies target/provenance, submits an exact SHA, waits for READY/SUCCEEDED and 100% serving, and performs non-destructive HTTP smoke. Report app-specific acceptance separately: an HTTP 200 is not business UAT. Release approval never authorises migrations, real customer bookings, emails or operational test writes.

## Rollback and interrupted releases

Rollback resolves the recorded verified previous-good source automatically. It never guesses old builds, rewrites history or reverts business data. If no earlier verified target exists, hold and explain the missing evidence. Advanced record/SHA overrides remain available to the agent when necessary, not to the ordinary owner workflow.

Twelve append-only `release/staging/<app>` and `release/prod/<app>` ledgers remain internal implementation details. They contain records, not deployable source; never deploy a ledger SHA. A remote pending intent and local plan-scoped journal prevent competing/duplicate rollout submission. Known-good targets and original recovery evidence are preserved.

`fika deploy <app> --prod --resume --execute` reuses the original bounded authorisation and source. It only verifies that attempt and never submits a duplicate rollout. No repeated owner comment or manually entered SHA is needed. A killed process's lock requires inspection, not automatic deletion.

For terminal failures the agent inspects `fika reconcile <app> --prod`, then uses `--resolution abandon|complete --rollout <observed-ID> --execute --owner-approved --reason <owner recovery/rollback instruction>`. The agent resolves attempt IDs internally. Reconciliation requires a returned submitter, positive terminal identity, paginated build/rollout/operation discovery, two stable snapshots and original journal/rollback lineage. Active or unknown outcomes cannot be abandoned. The original journal is archived before a non-force resolution; no deployment is submitted. Healthy successes must be completed. Abandoned unhealthy releases permit only verified rollback and are never themselves known-good targets. There is no force-abandon option.

### Forward adoption of an externally serving staging baseline

Only when the owner explicitly authorises it, `fika reconcile-serving-baseline hub --staging --sha <exact SHA> --rollout <build ID> --reason <owner instruction> --execute` may append a prospective baseline when the release ledger is behind an already-serving staging release. This path is restricted to Hub staging. It requires two identical authoritative App Hosting snapshots, the exact Firebase project/backend and source repository/root, a READY build at the exact commit, a SUCCEEDED matching rollout, one current 100% traffic split, automatic rollouts disabled, no reconciliation in progress, and a non-redirecting HTTP 200 serving probe. It binds the authenticated repository writer, owner instruction, actual UTC authorization/observation times, exact source and rollout, and prior ledger commit. The existing entry remains the first parent; ordinary non-force push provides compare-and-swap protection. It does not assert that an earlier rollout was governed and does not designate unverified intervening builds as rollback candidates. It cannot resolve a pending intent or operate on production. This is a ledger reconciliation only; it does not deploy or alter Firebase state.


### Pre-submission failures (staging)

`deploy --execute` first proves the Firebase CLI is authenticated (a read of the target backend) and only then writes the release intent, so an expired login stops with `firebase login --reauth` and writes nothing. The original submission's CLI exit status and an attempts list are recorded in the journal.

If a staging submission fails and Firebase holds no build or rollout for it, `deploy <app> --staging --resume --execute` resubmits the SAME intent (same release ID, pinned SHA and authorisation) exactly once, only when all of these hold: the original submitter returned, a 10-minute quiet period has passed, two identical recovery snapshots show no build or rollout created after the intent, no operation is in flight, traffic is quiescent and serving equals the pre-submission state, and Cloud Audit Logs are readable and show no `CreateRollout`/`CreateBuild` for the backend since the intent. The attempt is claimed durably before submitting, so a second or concurrent resume can never submit again; a failed resubmission is recorded and never retried automatically. Any doubt (including a build or rollout in any state) leaves the intent pending and resume verifies as before, now reporting what Firebase holds. Production never resubmits automatically.

## Optional hosted runner

Local releases need no new cloud identity. Optional `workflow_dispatch` uses the same owner-instruction inputs and CLI, without manual environment review. Pre-credential checks require the exact repository numeric IDs, main ref, release workflow, dispatch event and app/environment. Production also checks the owner actor and explicit authorisation input.

Only if hosted execution is wanted, separately authorise environment-scoped `FIKA_GCP_WORKLOAD_IDENTITY_PROVIDER` and `FIKA_GCP_RELEASE_SERVICE_ACCOUNT`. `fika trust <app> --prod|--staging` generates restricted exact-subject/ref/workflow conditions. Use dedicated least-privilege identities and correct issuer/audience, without broad principalSet bindings. Hosted journals persist for 30 days; the agent restores the original artifact for resume/reconciliation and preserves evidence before expiry. Missing hosted identity does not block the local CLI.

## Safe retirement and existing history

Finish/retire only your own completed workspace. `--preserve-generated` moves allowlisted ignored dependencies/build outputs into recovery archives without deleting their contents. `.env`, other unique ignored files, changed HEADs and unpreserved commits block removal. `--archive` separately creates a recovery ref and verified Git bundle for unique clean commits. Ambiguous worktrees, seven existing stashes, recovery archives, rollback refs and unfinished Logistics work remain protected. Bounded cleanup retires only positively redundant unattached local refs after preservation.

CPU lineage baseline: production source `94287ecf98504cc67ba6c09a0de32dcfe8d949da` came from PR #2. Preserve that deployed commit as an ancestor during reconciliation; never squash or cherry-pick away its identity. For each subsequent promotion, compare the actual serving source and release ledger against the candidate rather than relying on this historical SHA. Integration removes a missing-ancestry blocker, not the exact-source CI, staging, owner-authorisation or runtime verification gates.
