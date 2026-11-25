# 2026-11-25 — Retire verified TypeScript build caches

Workspace inventory separates physical worktrees from the permanent ten governed slots and recognizes only the explicitly owner-authorised #687 bootstrap record. Retirement can remove an ignored TypeScript build-info cache only when its bounded structure, compiler version and incremental configuration match tracked app inputs; unknown output and attachments remain protected. Verified cache residue and empty parent directories reconcile after native Git removal. Governed worktree creation and inventory now follow one SQLite-to-Git lock order, avoiding the claim deadlock found under parallel validation. SQLite capacity-lock acquisition retries transient busy/locked responses for up to 30 seconds.

Validation: 17/17 source-workspace lifecycle tests passed before the lock-order adjustment; the targeted 10-slot concurrent claim test passed after it. The full tooling suite ran 213/214 tests and exposed the claim lock-order deadlock; exact-source CI will rerun the full suite on the final fix.
Deployment: none.
