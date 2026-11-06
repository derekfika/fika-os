# Task worktrees and historical workspace evidence

Each write task uses one independent Git worktree and a unique task branch from fetched
`origin/main`. One writer uses each checkout. Task owner, baseline, paths and completion
are advisory records. Concurrent tasks can touch the same paths in different worktrees.
Review open PR overlap before editing and coordinate provider and consumer changes.
Git and protected PR review resolve conflicting source changes.

```powershell
npm run fika -- workspace create <task> --owner <agent-task> --scope <paths>
npm run fika -- workspace check <task>
npm run fika -- integrate --workspace <task> --pr <number>
npm run fika -- workspace complete <task> --owner <agent-task>
```

`--scope` is optional and provides an overlap hint. Treat an unavailable or partial PR
inventory as a prompt to inspect GitHub directly. Validate from the task checkout. Refresh
the branch by merging current main, review the resulting diff and rerun exact-source CI.
Integration checks the same repository, current base and exact PR head and asks GitHub
for a protected merge commit pinned to that head.

Completion records the final source and observed pushed/main/PR evidence. It retains
the checkout, including untracked and ignored files, unique commits, branches and stashes.
Use `--preserve --reason` for an explicitly unfinished outcome. The dashboard's worktree
inventory is read-only.

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

Release locks, local journals and remote intent ledgers keep their existing authority.
Use the [release operator guide](workflow.md) for interrupted releases and [deploy marker
recovery](deploy-marker-recovery.md) for the exact deploy marker procedure. Legacy
validation and dev marker recovery still requires administrator authority and confirmed
process exit. Dev additionally requires idle allocated ports. Recovery preserves audit
evidence and never transfers source ownership. Historical source recovery files and old
worktrees stay available for explicit inspection.
