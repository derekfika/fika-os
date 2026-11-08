# Solo Worker Governance Proposal

**Status:** Superseded design proposal. [Owner directive #422](https://github.com/derekfika/fika-os/issues/422) replaces the source-lease model with independent Git worktrees. This document is retained as historical design evidence. See [current workspace management](workspace-management.md).
**Prepared:** 2026-11-05
**Baseline:** `origin/main a9ec82397653300f4ec6523bf7ec5354797e072d`

## 1. Existing workflow and its costs

FIKA OS already has meaningful source and release safeguards. A normal task starts in a new task-named worktree from `origin/main`, records a scope and lease, and keeps its own branch. The current CLI has separate lifecycle commands for create, check, finish, retire and complete; administration adds status, publish, release-all, sweep, validation/dev marker recovery and a specialized stacked-lease recovery. Durable operation markers, registry/revocation journals, process checks and Git fences protect work that cannot be safely inferred from a quiet checkout.

This design has three costs for a single implementation worker:

1. Worktree and lease administration is optimized for concurrent writers even though the proposed default has one implementation worker.
2. Clean successful work commonly creates and retires a worktree instead of safely reusing one clean checkout.
3. Recovery tools are operation-specific or global. There is no general, exact-lease administrative recovery path for a genuinely abandoned workspace.

The existing `workspace complete` command already combines normal completion work. Solo Mode should preserve and simplify that path rather than replace it with another wrapper. The durable operation records, source branches, immutable release journals and explicit data-safety rules are safety controls; this proposal does not remove them.

## 2. Proposed architecture

### 2.1 Opt-in Solo Mode

Use one active implementation lease and one primary managed checkout for newly started Solo Mode tasks. Every task still receives a unique task name, lease ID, source baseline, scoped task branch and completion record. A task branch and PR history remain after the checkout is reused.

Read-only investigations may inspect code and evidence without a write lease, branch or workspace. They may not edit files, commit, alter external state or perform UAT. Luna is the default coordinator and implementation worker, owns tests, browser UAT, PRs, integration, release execution when authorised, issue tracking and operational verification.

Parallel implementation remains possible only through a separately owner-authorised, run-scoped parallel plan. That plan records the run ID, named workers, disjoint scopes, source baseline and coordinating owner. The normal scope checker still rejects overlap. Turning on parallel mode does not revoke, convert or reassign existing leases.

An active lease never becomes stale based on elapsed idle time. Only an explicit, audited finish or administrator recovery changes ownership.

### 2.2 Targeted recovery of one abandoned lease

Add a direct command such as:

```text
workspace recover-one <name> --owner <owner> --lease-id <uuid>
  --source <identity> --reason <administrator reason> [--execute --approve-hash <hash>]
```

This is a proposed interface, not a command available in the current CLI. It must target exactly one lease and must not be implemented through `release-all`.

The read-only preview binds the workspace name, owner, exact lease ID, repository/common directory, registered worktree, branch, baseline, current HEAD, remote source ref, tracked/untracked/ignored inventory, Git operation state, relevant operation markers and locks, active-process evidence, current main SHA, administrator identity and reason. It classifies each path and operation as recoverable or protected. The source identity is a digest over those observed values, not a user-supplied label alone.

An idle timestamp is never proof of abandonment. Recovery is eligible only after an administrator explicitly declares the task abandoned and current inspection shows no live or ambiguous worker/process, no target operation, no Git transition and no relevant lock. An inaccessible process table, malformed marker, unknown owner, changed HEAD or ambiguous operation denies recovery. Unrelated leases stay active; operation markers and release journals are never removed as a side effect.

Before the authority transition, the tool preserves:

- All reachable commits and branch refs in a verified Git bundle.
- Staged and unstaged binary changes in a checksummed patch/archive.
- All untracked files in the recovery archive, including modes and symlink metadata.
- Unique ignored files by retaining the original checkout in place and recording their paths and status. Recovery does not delete or retire that checkout; sensitive ignored contents are not copied or printed.

Preview approval is bound to the exact state digest. Execution rechecks the preview under the existing workspace lock, writes additive preservation artifacts, rechecks again, then commits one atomic, checksummed revocation/audit journal event. A pre-commit failure leaves ownership active. A post-commit retry reads the committed event and never repeats the transition. The former checkout is fenced and remains preserved. A successor can edit only after acquiring a fresh lease and a new task workspace.

### 2.3 Safe reuse and one-step task completion

Keep the existing completion command as the only normal finish operation. Extend it only after the targeted recovery work is complete:

```text
workspace complete <task> --owner <owner> [--preserve --reason <why>] [--reuse]
```

Lifecycle: START → IMPLEMENT → TEST → INTEGRATE → FINISH. A successful completion validates the final source state, exact pushed branch/PR and required CI evidence, records the result, releases ownership and either leaves the checkout available for safe reuse or retires it using current preservation rules. It is idempotent: a retry returns the recorded completion without releasing another lease or repeating cleanup.

Reuse is allowed only for the completed worker's clean checkout after its old task branch is pushed and preserved. Starting the next task fetches main, creates a new task branch from the new baseline, creates a new lease ID and scope, and records a new task identity under the existing workspace lock. It does not reset or force-update the old branch. Any dirty/untracked/unique ignored state, active operation, unresolved Git marker, changed owner or uncertain registration refuses reuse and preserves the checkout. The caller may use a newly allocated managed workspace instead.

An interrupted task uses the existing explicit preservation path. It records commits, staged/unstaged changes, untracked and unique ignored inventory before releasing ownership; it is not reported as successful completion.

## 3. Six production and safety gates remain mandatory

| Gate | Enforcement retained in Solo Mode |
|---|---|
| **1. Source integrity** | Fetched `origin/main` baseline, task branch and lease, scope enforcement, preserved history, validated diff, no force push or destructive reset. |
| **2. Operational data and food safety** | Existing allergen review/unknown semantics, dual signatures and revocation, immutable publications, canonical orders, correct dish/quantity/unit/destination identities, OPLOC authority, one-off destination handling, atomic/idempotent writes, revisions and audit evidence. Detailed rules stay in the platform and app references. |
| **3. Automated validation** | Focused regression tests, affected app typechecks/builds, shared-contract consumer tests, exact-source CI and protected merge gate. No CI bypass. |
| **4. Staging verification** | Same app/dependency tree staging for operational/data-sensitive changes, focused critical-path UAT, verified staging identity and isolation, authorised synthetic fixtures only. |
| **5. Production release** | Explicit owner approval for exact app/action/source, integrated main provenance, governed release workflow, append-only release journals, verified rollback. Automatic Firebase rollouts stay disabled. |
| **6. Post-release verification** | Verify actual serving source, completed rollout, 100% traffic, health and required smoke tests. Submission alone is not success. |

Solo Mode changes who owns a task and how a clean checkout is reused. It does not change the gates, their evidence or the fail-closed outcomes.

## 4. Proposed shorter authoritative policy

After owner-approved cutover, root `AGENTS.md` should be reduced to:

1. **One implementation owner by default.** Luna owns implementation and UAT. Optional Sol work is read-only, high-reasoning and limited to two assignments per overnight run; Sol never does UAT. No historical Claude/Haiku/Sonnet routing.
2. **One governed task lifecycle.** Start from fetched main, record scope/source, work on a task branch, validate, integrate through exact CI and complete once. Preserve unfinished work explicitly. Never edit or retire another task's workspace.
3. **The six gates above.** Keep the compact summary at root and link to existing domain, allergen, persistence, auth, logging/audit, cost and release specifications.
4. **Issue and change records.** Prioritise P0 operational risk; issue text records complexity, recommended model and reason. Each implementation adds a unique app/platform change fragment.
5. **Parallel mode is explicit.** The owner authorises a run-scoped parallel plan with named workers and non-overlapping scopes. Existing tasks are not automatically migrated.
6. **No autonomous destructive recovery or deployment shortcuts.** Use exact-lease recovery previews and current governed release interfaces; never bypass authorisation, CI, staging, rollback or evidence.

Detailed contracts and food-safety rules remain in their current references rather than being copied into root policy.

## 5. Proposed overnight note

After cutover, `overnight.md` should cover only execution:

- Luna continuously owns the run, implementation, critical-path UAT, issues and morning handoff.
- One coding worker is the default. Optional Sol audits are read-only, High/Extra High, never Fast, at most two per run, and never UAT.
- A failed scenario creates a bounded evidence-backed investigation. Retry a failed environment/auth path once with a supported alternative; continue unrelated safe work; do not spin on unavailable access.
- Prioritise release-critical P0s. Distinguish defect, fixture gap, environment/access limit and tester misunderstanding. Missing evidence is BLOCKED/UNKNOWN, not PASS.
- Keep all test writes synthetic and staging-isolated. Verify identity, permission and downstream effects before action.
- Make GO/NO-GO per app/release. Keep exact CI, staging, approval, rollback and post-release checks separate and mandatory.
- Morning report lists source SHA, PR/CI, UAT evidence, blockers, approvals, deployment/serving evidence and next owner action.

Keep the existing authenticated custom-domain browser guidance verbatim or equivalent: start at `https://staging-os.fikacatering.com/`; use the listed app custom domains; preserve the authenticated session and return path; verify the served build; never substitute `*.hosted.app`; if browser access fails, mark authenticated UAT blocked and continue only safe independent checks.

## 6. Backward-compatible migration and PR sequence

Solo Mode is opt-in until current P0 recovery finishes and the owner approves the cutover. Existing leases, PRs, branches, journals, operation markers, ignored files and recovery archives keep their current meaning. No automatic lease conversion, stale-by-time revocation or historical journal rewrite occurs.

1. **PR A — this proposal:** architecture, existing complexity, six gates and migration plan. Documentation only.
2. **PR B — targeted exact-lease recovery:** implemented after P0 workflow-file leases release. Add isolated temp-repository tests for exact identity, preview/hash drift, idle-age-only recovery denial, declared abandonment with no live process, active and ambiguous-process/lock denial, preservation of every file class, concurrent attempts, administrator authorisation, atomic/idempotent revocation, fresh successor lease, no source loss, legacy compatibility and unchanged release governance. Never test against a real workspace or live Cloud.
3. **PR C — Solo lifecycle and reuse:** one-worker default behind an opt-in mode. Add tests for start/complete/reuse, new baseline/branch/lease, interrupted preservation, dirty/ignored protection, idempotency and old lease compatibility.
4. **PR D — policy consolidation:** after P0 completion, shorten root `AGENTS.md` and `overnight.md`, retain custom-domain auth/browser guidance and link to detailed specifications. Owner reviews and explicitly approves Solo Mode activation.

Before cutover: run focused governance tests, full workflow tests, `workspace check`, exact-source CI and a dry-run migration inventory. Verify no legacy lease or operation is changed. Activate only for new tasks after owner approval; existing tasks finish under the policy and lease identity with which they started.

## 7. Non-interference and deferred dependencies

This proposal was scoped to one new documentation path. It did not modify root policy, release code, workspace registries, marker files, journals or P0 branches.

At audit time, the P0 owned or depended on:

- `legacy-deploy-marker-recovery`: `tools/workflow/deploy-marker-recovery.mjs`, its tests, its deployment guide and its unique change fragment.
- `overnight-menu-prod-baseline-core` / #364: `tools/workflow/releases.mjs` and `tools/workflow/releases.test.mjs`.
- `sprint-scope-amend`: `tools/workflow/cli.mjs`, scope-amendment module/tests and its guide.
- PR #368 security containment: shared Drive provider, CPU/Delivered-In source and tests, and their app/platform change fragments. PR #367 cache containment remains stacked on #366.
- Active #175 and #251 scopes; #340 No Key audit; #364 reconciliation.
- Current release ledgers and rollback journals under the shared workflow state.

The shared workflow state contained deploy operation marker `e060955d-705c-476b-b785-a74ebcd35582`, recorded for canonical operator PID 16152, started 2026-11-02T19:44:34Z. That PID was absent at inspection. The P0's `legacy-deploy-marker-recovery` lease owns this evidence; this task did not inspect its release payload or alter it.

**Deferred:** PR B/C code requires the workflow CLI and workspace core to be unleased. PR D requires P0 completion and explicit owner cutover approval. The proposal is not a feature activation or authorization to recover any current lease.
