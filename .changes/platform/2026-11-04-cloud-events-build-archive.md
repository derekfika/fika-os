# 2026-11-04 — Preserve Events Dashboard build output on retirement

Added only `apps/events-dashboard/.next` to the governed generated-output archive allowlist. Retirement renames this ignored directory into the workspace recovery archive before removing its worktree; all contents are preserved and recorded in the archive manifest. Ownership, lease state, dirty-file checks, symlink checks, and retirement protections are unchanged.

Validation: workspace lifecycle regression test confirms a file inside this ignored directory survives byte-for-byte in the archive.
Deployment: none.
