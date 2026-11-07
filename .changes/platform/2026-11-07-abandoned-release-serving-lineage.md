# 2026-11-07 — Abandoned release serving lineage

- Date: 2026-11-07
- Task: Hub production release recovery
- Summary: Accept an abandoned release entry that retains the independently verified previous-good serving state while recording the failed rollout in recovery evidence. Validate every terminal record before appending it so malformed abandonment records cannot enter release ledgers.
- Validation: Focused policy, recovery, and release workflow tests passed (59/59); exact-source CI pending. A broader workflow run started before a test-fixture correction reported one stale first-release fixture failure; the corrected focused recovery test now passes.
- Deployment: Not deployed; the Hub production deploy dry-run is blocked by the existing invalid abandoned record until this fix is merged.
