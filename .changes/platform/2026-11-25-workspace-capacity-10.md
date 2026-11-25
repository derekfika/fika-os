# 2026-11-25 — Expand governed workspace capacity to ten (#687)

The canonical checkout stays separate while ten task worktrees share the existing reservation lock and queue. Startup and health report the ten-slot inventory. Successful governed rebuilds refresh fingerprints for known output when existing paths still match their prior fingerprints and the rebuild adds no unverified paths. Retirement preserves source, unknown ignored files, attachments and existing Git recovery evidence.

Validation: Windows workflow tests cover concurrent claims, the queued eleventh claim, startup retirement, queue order and generated output protection.
Deployment: none.
