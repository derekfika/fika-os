# 2026-11-16 — Dispatch the approved config-only CLI action

Aligns release dispatch with the parser's canonical hyphenated `--config-only` option so the governed configuration-only plan runs instead of the ordinary source deployment path. Adds the fix to the existing production Hub catch-up approval-hash rollout; no runtime configuration or Calendar state was changed.

Validation: 34 release/CLI tests passed after the fix; full workflow validation passed 167 tests before this dispatch-only correction.
Deployment: none. The corrected first-page configuration preview is read-only and pending a fresh run after merge.
