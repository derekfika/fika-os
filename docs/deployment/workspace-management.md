# Workspace management

The authoritative registry is under the shared Git directory's `fika-workflow/workspaces`.
Every CLI and dashboard call uses this registry and the existing `workspaces` concurrency
lock. Agent assignments on deployment cards remain advisory. No deployment/release lock
is overridden by workspace administration.

## Normal completion

After validation, commit and push. From the canonical checkout run:

```powershell
npm run fika -- workspace complete <task> --owner <agent-task>
```

The command checks scope, branch, final HEAD, pushed/main evidence and matching PR,
records completion, releases the active lease, and attempts `retireWorkspace`. Open PR
branches remain. Unique clean commits get a verified bundle/ref before retirement.
Allowlisted ignored dependencies/build outputs are archived. Dirty/untracked data,
unique ignored files such as `.env`, a changed HEAD, locked registration or the calling
checkout protect the worktree. Cleanup protection never reactivates the finished lease.
If a task ends with unfinished work, use `--preserve --reason "<explanation>"`: a private
checksummed recovery manifest captures binary staged/unstaged patches and untracked
files, and a verified Git bundle preserves commits. The original checkout and ignored
files remain. Do not use completion to disguise an interrupted or ongoing task.

`workspace finish` and `workspace retire` remain low-level compatibility primitives;
normal agent returns must use `workspace complete` and report its exact outcome.
Completion publishes a timestamped status snapshot; publication failure is reported as
pending and can be retried with `fika workspace publish --execute`.

## Recover exactly one clean, pushed stacked lease

`workspace recover-stacked` is a separate administrator decision, not completion or
permission to integrate. It revokes exactly one active lease through the existing atomic
revocation journal/reader overlay. It never retires the checkout, edits its scope,
transfers files, closes a PR, or changes existing branches. Normal scope checks remain
unchanged. The former owner is fenced; a successor needs a new governed workspace.

Run the **current canonical CLI from the canonical checkout** after this tooling PR is
integrated. Authentication requires the local GitHub repository owner with administrator
permission. Both preview and execution require the exact task/owner/lease ID, pinned HEAD,
open same-repository main-targeted PR, exact retired predecessor name/ID, explicit future
integration scope, and a reason of at least eight characters. Preview is the default.

The command verifies registered, clean source checkout; exact remote source HEAD; a fresh
main ref; unique integration merge base; both baseline ancestries; a retired ancestor's
matching preservation ref and verified bundle; and at least one scope-blocking file
identical to that ancestor. It lists **all** paths for review, distinguishing inherited
files from additional scope-blocking files. A proven ancestor does not establish the
authority or correctness of later changes. Review those separately. Unpushed commits,
dirty/untracked files, unfinished Git/workspace transitions, inconsistent registry,
critical locks, and any durable operation marker (even for another lease) stop recovery.
Do not clear markers/locks to obtain a preview; use their existing recovery procedure.

Execution requires the reviewed `--approve-hash`. Under the workspace lock it repeats
inspection, creates an additive preservation ref, full-history verified Git bundle and
private checksummed recovery manifest, then repeats inspection before one atomic audit
journal commit. Changed registry, operations, main/source HEAD, PR metadata, reason,
scope or ignored-path inventory invalidates the preview. Files already ignored are kept
in place; their contents are not read/copied or certified immutable. A failure before
journal commit leaves ownership active and may leave useful additive recovery evidence.
After a committed journal, fresh readers show only that lease revoked. Retrying execution
on a revoked lease fails; inspect readback rather than resubmitting. A checksum failure
protects the registry. Nothing here overrides release locks or grants deployment authority.

### Controlled #128 procedure (documented only; not executed by this implementation)

The owner must first authorise **administrative execution for lease
`ce4355ac-20b8-4a6a-8f6f-bb2a09900f71` only**, independently of authorising this code.
Coordinate in [#160](https://github.com/derekfika/fika-os/issues/160). Wait for Claude's
Rotations/#164 operation to finish and its overlapping lease to be normally completed;
do not revoke it. Recheck all leases and operations. Preserve #125/#128 and all recovery
archives. If source evidence has changed, stop and obtain a newly reviewed procedure.

After the tooling is integrated, an authorised administrator runs these preview steps in
`C:\Fika\fika-os` (PowerShell):

```powershell
git fetch origin
node tools/workflow/cli.mjs workspace list
$mrHead = '37d757a2ca8f9b04343013fe817b631191a3e019'
# Review every path; exact file scopes avoid taking unrelated application ownership.
$mrPaths = @(git diff --name-only --no-renames "origin/main...$mrHead")
$mrPaths
$mrArgs = @('workspace', 'recover-stacked', 'munich-re-portal',
  '--owner', 'claude-munich-re-onboarding',
  '--lease-id', 'ce4355ac-20b8-4a6a-8f6f-bb2a09900f71',
  '--predecessor', 'munich-re-catalogue-minimums',
  '--predecessor-lease-id', 'c0778138-7945-4828-99f2-4b4e193cb982',
  '--head', $mrHead, '--pr', '128', '--scope', ($mrPaths -join ','),
  '--reason', 'Owner authorised preserved recovery of the stacked PR 128 lease only')
$mrPreviewJson = node tools/workflow/cli.mjs @mrArgs --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Recovery preview failed; stop' }
$mrPreview = $mrPreviewJson | ConvertFrom-Json
$mrPreview | ConvertTo-Json -Depth 20
```

Review the complete preview, including `inherited`, `additionalReviewPaths`, ignored
inventory and exact IDs/HEAD. The earlier #160 audit attributed the entire blocker to
the retired catalogue lease; current history also contains
`apps/integration-hub/tests/munich-re-booking.emulator.test.ts` added after its tip.
This file must be explicitly reviewed and included in the successor scope. The command
does not pretend it belonged to that predecessor. If preview is refused, stop with its
evidence; never use `finish`, bulk release, manual registry edits or force-removal.

Only after that separate owner decision and preview review:

```powershell
node tools/workflow/cli.mjs @mrArgs --execute --approve-hash $mrPreview.planHash
if ($LASTEXITCODE -ne 0) { throw 'Inspect authoritative readback; do not blindly retry' }
node tools/workflow/cli.mjs workspace list
node tools/workflow/cli.mjs workspace publish --execute
```

Post the result and fresh registry readback to #160: `leaseReleased=true`, target state
`revoked`, retirement `protected`, preserved source/ref/bundle/manifest, unchanged other
lease states, and snapshot-publication result. Verify old branch/HEAD, worktree and ignored
files remain. Snapshot publication is separate; failure does not undo revocation.

Claude can then acquire a **fresh** scope covering the reviewed full #128 diff (and any
additional paths separately required for integration) using an unused name:

```powershell
node tools/workflow/cli.mjs workspace create munich-re-128-integration --owner claude-integration-lead --scope ($mrPreview.scopes -join ',')
```

This creates a new branch from freshly fetched main; it does not adopt/relabel the old
worktree. In the new workspace, merge the preserved `codex/munich-re-portal` branch with
history retained, then run the unchanged scope check, affected validation and required
app/shared/emulator checks. Any overlap or new conflict path needs a separately governed
allocation; never copy files around fencing. Keep #128 as historical evidence and use a
new integration PR matching the successor branch, exact-source CI and merge-commit policy.
Do not alter or close #128 without separate direction. No deployment, operational write,
pricing decision or production action is authorised by recovery.

## Administrator release of all leases

Open <http://127.0.0.1:4180/#workspace-management>. Start the dashboard with the existing
`npm run deploy:dashboard` command. Load the workspace register, then select the red
**RELEASE ALL LEASES** control. Review every eligible/protected lease, enter a reason
(at least eight characters) and type **RELEASE ALL LEASES** exactly. The server verifies
the locally authenticated GitHub repository owner's administrator permission, the
loopback host, dashboard token and same-origin JSON request. Login alone is insufficient.

CLI equivalent, run from the canonical checkout:

```powershell
npm run fika -- workspace release-all --dry-run
npm run fika -- workspace release-all --execute --approve-hash <preview-hash> --confirm "RELEASE ALL LEASES" --reason "Recover ownership after agents disappeared"
```

Preview hashes bind the complete registry and critical-operation inventory. A concurrent
lease acquisition, completion or operation change requires a new preview. A single
atomic committed journal is both the revocation authority and durable audit event;
readers overlay it so a restart cannot produce partial revocation. Repeating the same
approved hash returns the original result. Every checkout, local branch, commit, stash,
untracked/ignored file and recovery artifact is retained. Revocation never removes a
worktree. Missing agents do not block revocation.

Creating/reconciling/inconsistent leases, durable in-flight/interrupted validation,
integration/release operations, unfinished reconciliation journals and existing release
locks are protected with an explicit reason. No TTL declares them dead. Recover the
original operation using its journal and existing release/reconciliation procedures;
do not delete locks or markers merely because a PID disappeared. A malformed registry
or audit checksum protects all leases until its preserved evidence is reconciled.

For an exited validation process only, an administrator may run `fika workspace
recover-validation <operation-id> --reason "<verified outcome>"`. It checks that the
recorded process is absent, audits recovery and removes its marker under the registry
lock. It refuses live processes and every release/integration operation; those retain
their existing recovery procedures.

For an exited dev process, an administrator may run `fika workspace recover-dev
<operation-id> --reason "<verified shutdown evidence>"` from the canonical checkout.
It requires the matching workspace lease, an absent recorded process and all allocated
workspace ports to be available, preventing recovery over an orphan dev listener.
It preserves the original operation in an audit event before removing only that marker
under the registry lock. It does not release the lease: use normal `workspace complete`
after recovery. Live processes, integration and releases remain protected. No manual
marker deletion, process termination or release-journal changes are performed.

## Fencing and supported tooling

After upgrading the canonical checkout, run `fika workspace install-fences`. It preserves
and forwards prior Git hooks and installs common pre-commit/pre-merge/pre-rebase/pre-push
guards, so even an old agent pushing from a revoked checkout is refused. Keep this hook
configuration intact. New governed commands read the authoritative registry before
validation, integration, dev or release and register a durable critical-operation marker.
Revoked/finished ownership cannot run those operations. Use the **current canonical CLI**
from old worktrees; old copied executable code cannot be retroactively upgraded. Arbitrary
manual test commands are not governed validation or evidence of ownership. Integration
uses `fika integrate --workspace <task> --owner <agent-task> --pr <number>` and verifies
the exact head's merge gate before a protected merge-commit merge.

## Separate safe cleanup

```powershell
npm run fika -- workspace sweep --dry-run
npm run fika -- workspace sweep --execute --approve-hash <preview-hash>
```

Sweep requires administrator authority for execution. It considers only unchanged,
finished workspaces with no dirty/untracked/ignored files and no unpreserved unique
commits. It retains branches, stashes and recovery data and uses non-forced Git worktree
removal. Active and revoked worktrees stay protected. Its disk summary reports file-size
estimates/lower bounds with capped inventory; archival storage is not reclaimed. A changed
preview is rejected. Failed removals remain protected and are reported individually.

## GitHub snapshot

`fika workspace publish --execute` creates an ordinary append-only commit on
[`meta/workspace-status`](https://github.com/derekfika/fika-os/blob/meta/workspace-status/WORKSPACES.md).
It publishes only name, owner, scope, branch, recorded PR, state and update time. It never
publishes local directories, recovery payloads, file contents or credentials, and never
commits runtime status to main. Publication uses a normal push for concurrency protection.
The report is a timestamped snapshot; it never replaces local authority.
