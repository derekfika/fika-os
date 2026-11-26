# 2026-11-26 — Independent weekly menu views

Added a Week Planner menu selector that switches between Main Lunch and each supplementary menu for the selected week. Each option opens the existing canonical menu-week identity and its independent saved row layout, dishes, quantities, allocations, PAX and publication state. Supplementary options remain available for the full week even when their occurrence is scheduled on another weekday. Existing unsaved-draft navigation protection remains enabled.

Validation: focused regression tests passed (34/34); full Menu Planning suite passed (598 passed, 5 skipped); typecheck and production build passed. The repository-wide `fika validate` command was stopped after repeated temporary-worktree setup with no completion output; exact-source CI and staging acceptance remain required.
Deployment: staging deployment and isolated acceptance pending governed merge; no production deployment authorised.
