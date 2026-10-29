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
