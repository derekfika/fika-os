# 2026-11-06 — Workspace Management v2 B1 mutex and authority

Add a process-owned SQLite registry mutex and an atomic compatibility sentinel for a later governed cutover. Existing workflow writers continue to use the legacy mutex. Workspace readers, operation admission and the Git fence share the committed reconciliation and revocation view. New reconciliation replacements receive fresh lease IDs.

Validation: Windows mutex fixtures, pre-materialization reconciliation authority, release-lock isolation, scope and changelog checks. Exact-source CI adds the focused Windows job alongside the Linux workflow suite.
Deployment: none.
