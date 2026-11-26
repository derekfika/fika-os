# Task worktrees and lifecycle

Use the current CLI from the canonical checkout for machine-wide workspace commands.
Each write task claims one of ten governed slots, a unique branch from fetched
`origin/main`, and an independent checkout per coherent implementation task or
independently mergeable PR. The primary checkout is excluded. Multiple cooperating
agents may write in the same task checkout with explicit, non-overlapping file
ownership. One accountable task owner controls Git operations, dependency installation,
integration and retirement, and coordinates builds and emulator use. Read-only
investigation and review need no checkout. Inventory reports physical checkout count
separately from governed slot occupancy; an owner-authorised bootstrap exception is
recorded explicitly and never creates another ordinary claim slot.
Existing linked worktrees and unregistered directories in the managed workspace root
count against the limit. A tree outside governance can consume a slot and will appear
as unmanaged. Keep it in place until identity and ownership are known.

The one-time #687 owner bootstrap was a narrowly recorded exception to the ten-slot
admission limit for the retirement repair itself. It is visible in physical inventory,
does not reduce or expand ordinary capacity, cannot be requested by task workers, and
must be retired or formally adopted after the repair is integrated. Future lifecycle
defects use the separately logged, scope-limited `create-recovery` mechanism below;
ordinary capacity pressure still queues.

```powershell
npm run fika -- workspace startup
npm run fika -- workspace create <task> --owner <agent-task> --scope <paths>
npm run fika -- workspace assign-writer <task> --owner <task-owner> --writer <agent-name> --scope <paths>
npm run fika -- workspace writers <task>
npm run fika -- workspace check <task>
npm run fika -- workspace install <task> --package apps/<app-directory>
npm run fika -- integrate --workspace <task> --pr <number>
npm run fika -- workspace complete <task> --owner <agent-task>
```

Windows and other supported hosts use the shared Git directory for registration and a
SQLite `BEGIN IMMEDIATE` lock for slot changes. Lock acquisition retries SQLite busy or
locked responses for up to 30 seconds, then returns an actionable hold without making
a claim. Node 22.13 or later is required. A claim
reserves its slot before Git creates the checkout. With ten occupied slots, the next
claim queues with its task name, owner and advisory scope. Startup, executed cleanup
and verified completion promote queued claims in FIFO order as physical slots open.
The result lists admitted tasks and any reason the head claim is blocked. Use
`workspace create <task> --owner <agent-task>` to retrieve an automatically admitted
checkout or retry the oldest claim. Review advisory overlap before editing. Withdraw
a claim with `workspace cancel <task> --owner <agent-task>`. Dispatch the worker only
after the checkout is active.

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
It deletes only the verified local branch after both the registration and physical
path are gone. If native Git leaves an unregistered directory, the slot stays
occupied and health reports it as retirement residue. Run `workspace cleanup <task>`
to preview the recovery. The same command with `--execute` can finish an interrupted
or previously recorded retirement when the archive, completion and merged PR match.
Only dangling npm dependency links proven by the governed install and the tracked
lockfile at the completed source, plus their empty parent directories, are eligible.
Any other content or ambiguous Git state holds the workspace and is reported with a
reason. Use `workspace prune` to
preview already missing checkouts and `workspace prune --execute` to preserve their
Git admin index and reflog before native pruning. An unresolved path or unexpected Git
prune result requires inspection. Archived data, deployment evidence and stashes
remain in place.

`workspace health` is a bounded inventory check by default. It reports volume free
space, slot occupancy, queue and policy violations without cleanup or recursive disk
traversal. `workspace health --deep` or `workspace storage-audit` explicitly runs the
recursive C:\Fika NTFS allocation scan; it counts hardlinked file allocation once and
skips junctions and other reparse points. Deep scans are bounded and can report an
incomplete result with diagnostics. Directory metadata, alternate data streams and
out-of-scope paths can make the filesystem footprint differ from volume free space.
Allocation associated with candidates may remain allocated through other hardlinks. Set
`FIKA_WORKSPACE_MIN_FREE_GB` or `--min-free-gb` to change the default 25 GB free-space
warning. `--output <file>` saves the report.

Completed task evidence is archived after the checkout registration and physical path
are verified absent; archive records remain available to history searches. Git status,
fetch, preservation and native worktree removal must run outside the shared SQLite
capacity lock. Lifecycle commits revalidate owner, task identity and exact source SHA.
A durable in-progress retirement continues occupying capacity until physical absence
is verified.

Infrastructure recovery is a separate owner-authorized path for repairing workspace
admission or retirement itself. Use `workspace create-recovery infra-recovery-<slug>
--owner <task-owner> --reason <reproducible-defect> --scope tools/workflow,AGENTS.md`.
The tool admits only one recovery checkout at a time, records the reason and exact
scope, and restricts edits to `tools/workflow` and the named governance documents. It
does not authorize app changes or ordinary task capacity. The task remains subject to
preservation, source validation, protected integration and retirement. Routine capacity
pressure remains FIFO queued.

For the specifically authorized legacy #687 bootstrap records, `workspace
reconcile-orphaned` previews archival and `workspace reconcile-orphaned --execute`
archives only the three allowlisted records whose checkout, process, lease and
operation references are absent and whose current remote branch head matches the
exact merged PR head on `origin/main`. This archival preserves the original metadata,
PR proof and remote branches; it does not invent completion records, remove branches,
or generalize to other bootstrap exceptions.

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
fingerprint. Validation includes Next's `next-env.d.ts`. For an existing unrecorded
declaration, retirement can independently verify the complete generated Next 16
template against the completed app's tracked lockfile and TypeScript configuration.
Retirement also recognizes the exact ignored `apps/<app>/tsconfig.tsbuildinfo` path
only when its bounded TypeScript build-info structure, compiler version in that app's
tracked lockfile, and incremental tracked TypeScript configuration agree. This cache
contains compiler-derived state and can be rebuilt from tracked sources. A malformed,
oversized, mismatched or edited cache remains protected. The exact pair of timestamp-
based CPython 3.14 caches under `apps/cpu-production/tools/xchange-print-agent/__pycache__`
is recognized only when both files exactly match a fresh compile of their tracked
sources using the source timestamp and pinned task commit; the modules are compiled but
not executed. Other unrecorded or changed content, links outside the checkout, browser
evidence, user attachments, env files and unknown scratch files remain protected. In
particular, an unrecorded `.next` tree is
not assumed disposable: successful governed validation fingerprints its full content,
and any changed or added path blocks retirement.
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
