# Task worktrees and lifecycle

Use the current CLI from the canonical checkout for machine-wide workspace commands.
Each write task claims one of ten slots, a unique branch from fetched `origin/main`,
and an independent checkout with one writer. The primary checkout is excluded.
Existing linked worktrees and unregistered directories in the managed workspace root
count against the limit. A tree outside governance can consume a slot and will appear
as unmanaged. Keep it in place until identity and ownership are known.

```powershell
npm run fika -- workspace startup
npm run fika -- workspace create <task> --owner <agent-task> --scope <paths>
npm run fika -- workspace check <task>
npm run fika -- workspace install <task> --package apps/<app-directory>
npm run fika -- integrate --workspace <task> --pr <number>
npm run fika -- workspace complete <task> --owner <agent-task>
```

Windows and other supported hosts use the shared Git directory for registration and an
OS-released SQLite lock for slot changes. Node 22.13 or later is required. A claim
reserves its slot before Git creates the checkout. With ten occupied slots, the next
claim queues. The oldest queued claim has first access to an available slot. Retry
`create` with the same name and owner when capacity becomes available. Withdraw a claim with `workspace cancel
<task> --owner <agent-task>`. Never dispatch a queued worker as though it has a checkout.

`--scope` provides an optional PR-overlap hint. If the inventory is partial, inspect
GitHub directly. Validate in the task checkout, commit, push, and open the PR. Refresh
the branch against current main and rerun exact-source CI after a refresh. Integration
checks the same repository, current base and exact PR head before asking GitHub for the
protected merge. Run `complete` from canonical after merge so the coordinator stays
outside the retiring checkout. Use the recorded source SHA and PR for later release.

### Cleanup and disk health

`workspace startup` reclaims eligible completions and reports free slots and disk
warnings. Run it at session startup and campaign close. `workspace cleanup` previews
eligible and protected tasks. `workspace cleanup [<task>] --execute` reconciles their
exact PR heads and integrated merge commits before using native Git removal. Both
normal merge commits and existing squash/rebase merges are eligible with matching
GitHub evidence. Open PRs, changed branches, missing owner records, operations,
uncommitted work and unknown ignored files retain their checkouts. `complete --preserve
--reason <why>` records explicitly unfinished work. Use a new task only when an
eligible prior completion has retired or a genuine blocker has been documented.

The CLI preserves Git admin evidence and reflog-only commits under
`<git-common-dir>/fika-workflow/source-recovery/` and `refs/preserve/source-recovery/`.
It deletes only the verified local branch after removal. Use `workspace prune` to
preview already missing checkouts and `workspace prune --execute` to preserve their
Git admin index and reflog before native pruning. An unresolved path or unexpected Git
prune result requires inspection. Archived data, deployment evidence and stashes
remain in place.

`workspace health --inventory-only` reports real volume free space, slot occupancy,
queue and policy violations. Full `workspace health` also reports the C:\Fika NTFS
file allocation by category and area and the maximum allocation associated with verified
cleanup candidates. It counts hardlinked file allocation once and skips junctions and
other reparse points. Directory metadata, alternate data streams and out-of-scope
paths can make the filesystem footprint differ from volume free space. Allocation
associated with candidates may remain allocated through other hardlinks. Set
`FIKA_WORKSPACE_MIN_FREE_GB` or `--min-free-gb` to change the default 25 GB free-space
warning. `--output <file>` saves the report.

### Dependencies and generated data

`workspace install` runs `npm ci --prefer-offline` with the selected package's tracked
lockfile. It reuses the canonical npm download cache when it is on the workspace
volume and outside the task checkouts. The fallback is `C:\Fika\.fika-cache\npm`.
Omit `--package` for the root manifest. The installed tree stays in the task. An existing dependency
directory requires inspection before native npm reinstall. For rollback of the local
cache workflow, run the existing `npm ci` command in the selected checkout. CI,
App Hosting, and production still use their existing npm configuration and lockfiles.

The governed installer and validation record known generated outputs they create.
Successful validation refreshes an existing output's fingerprint only when its
previous fingerprint still matched at launch and its paths and file types were
covered by that fingerprint. Interactive dev sessions do not register generated
output for removal. Retirement checks each ignored output against its recorded
fingerprint. Outputs with
unknown or changed content, links outside the checkout, browser evidence, user
attachments, env files and unknown scratch files still require explicit review.
Keep emulator databases, runtime state and build output checkout-local. Check
available CPU, memory, disk and isolated ports before starting intensive work.
Stagger builds and emulator runs when resources are constrained. Use the standard per-user Firebase
emulator binary and Playwright browser caches, or a single explicit binary-cache
override for all tasks. Run cache maintenance only with agents and tool processes
stopped. Retain release scratch and reports until their corresponding rollout and
evidence are reconciled. Retain Git reflogs and recovery refs.

Firebase App Hosting supports pnpm in general. FIKA still needs a staging build of
its app-root layout, local `file:` dependencies, shared import tracing, and approved
native install scripts before switching CI or deployment. The pnpm 12.23.0 probe on
the current Windows host was blocked by Device Guard. A standard content-addressed
store is the pilot baseline on an approved runner. NTFS hardlinks also share writes,
so the pilot must show safe package mutation isolation. Treat the global virtual
store as a separate local experiment with its own isolation and concurrency checks.

## Historical cutover

Run from clean tracked current canonical main with the authenticated repository owner.
Drain legacy workspace commands and governed operations before applying the migration.

```powershell
npm run fika -- workspace migrate --reason "Freeze historical source records for #422"
npm run fika -- workspace migrate --execute --approve-hash <preview-hash> --reason "Freeze historical source records for #422"
npm run fika -- workspace history
```

The preview checksums source records, journal manifests, refs and Git worktree
registrations. Execution uses a no-overwrite compatibility sentinel at the old source
mutex path, rechecks the evidence and saves a checksummed migration report locally in
`<git-common-dir>/fika-workflow/source-history-migration.json`. Repeating the command
returns the committed report. Source records, worktrees, branches, stashes, archives
and operation records remain in place. Older executables refuse registry writes when
they encounter the sentinel. The installed Git fence loads current canonical code and
continues forwarding existing hooks.

An existing unrecognized legacy mutex is protected. Review the exact lock and its
writer through the administrator incident process before freezing historical writers.
Ordinary source creation, validation, integration and completion already work independently
of that mutex. If a cutover was interrupted after installing its recognized sentinel,
review a fresh preview and complete the report. Use Node 22.13 or later on a local disk
for post-migration operation-marker writes.

## Interrupted operations

Recover an interrupted slot with `workspace recover <task> --owner <agent-task>
--reason "<confirmed checkout processes have stopped>"`. The owner verifies that the
creator and child processes exited. The CLI either adopts the intact baseline checkout
or releases an empty reservation. A leftover directory, branch or dirty tree needs
manual recovery. For interrupted governed validation, install or dev, use `workspace
recover-operation <id> --owner <agent-task> --reason "<confirmed processes have
stopped>"` after verifying child processes and any dev ports have stopped. A running
PID or ambiguous ownership remains protected.

Release locks, local journals and remote intent ledgers keep their existing authority.
Use the [release operator guide](workflow.md) for interrupted releases and [deploy marker
recovery](deploy-marker-recovery.md) for the exact deploy marker procedure. Legacy
validation and dev marker recovery still requires administrator authority and confirmed
process exit. Dev additionally requires idle allocated ports. Recovery preserves audit
evidence and never transfers source ownership. Historical source recovery files and old
worktrees stay available for explicit inspection.
