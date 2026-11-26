# 2026-11-26 — Publish scheduled supplementary menu weeks

Weekly publication now accepts a supplementary menu with one or more scheduled service days and continues to reject supplementary menus with no scheduled occurrence. Main Lunch retains its five-service-day publication requirement. Publication still includes only the selected menu's canonical scheduled days, preserving existing identities and explicit downstream handoff behaviour.

Validation: focused publication/draft suite passed (19/19); full Menu Planning suite passed (599 passed, 5 skipped); typecheck and production build passed. Repository-wide `fika validate` was interrupted after it stalled during temporary-worktree setup; exact-source CI remains required.
Deployment: staging acceptance pending; no production deployment authorised.
