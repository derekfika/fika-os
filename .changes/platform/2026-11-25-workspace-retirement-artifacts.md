# 2026-11-25 — Retire verified TypeScript build caches

Workspace inventory separates physical worktrees from the permanent ten governed slots and recognizes only the explicitly owner-authorised #687 bootstrap record. Retirement can remove an ignored TypeScript build-info cache only when its bounded structure (including nested root file-ID groups), compiler version and incremental configuration match tracked app inputs; unknown output and attachments remain protected. Verified cache residue and empty parent directories reconcile after native Git removal. Governed worktree creation and inventory now follow one SQLite-to-Git lock order, avoiding the claim deadlock found under parallel validation. SQLite capacity-lock acquisition retries transient busy/locked responses for up to 30 seconds.

Validation: 17/17 source-workspace lifecycle tests passed before the lock-order adjustment; targeted ten-slot concurrency and compiler-cache tests passed after their fixes. Full tooling CI passed; the first Windows source job found and corrected a fixture-path issue. Final exact-source Windows lifecycle CI is rerunning.
Deployment: none.
