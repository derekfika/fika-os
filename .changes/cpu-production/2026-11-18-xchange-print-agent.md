# 2026-11-18 — Xchange Brother print-agent foundation

Add a disabled-by-default Python agent core with authenticated HTTPS queue-client requests, bounded A4 PDF verification, durable SQLite job reservation, stable receipt IDs and fail-closed uncertainty handling. The printer boundary is injectable; this slice includes only a fake printer and does not install a Pi service or send paper.

Validation: 12 Python unit tests passed through the CPU test runner and directly with `python -m unittest`; CPU TypeScript typecheck passed; `git diff --check`, workspace scope and changelog checks passed. No emulator or production build was needed because no application runtime route or renderer changed. The wider governed `fika validate` run did not finish: existing workflow fixtures repeatedly attempted to create `codex/staging-release-manager-3`; the run was stopped and its process/marker/worktree state was checked clean. Exact-source CI remains required.

Deployment: none. No operational-data write, credential provisioning, printer dispatch or recurring background work.
