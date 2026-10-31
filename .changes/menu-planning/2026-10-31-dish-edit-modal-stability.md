# 2026-10-31 — Dish edit modal stability

Lock the background document while shared planner dialogs are open, keeping nested dialog locks safe and restoring the exact scroll position and inline styles on close. Fix the Dish Editor dialog to use a stable viewport width and an independently scrollable body, preventing focus, internal scrollbars and narrow viewports from shifting its position.

Validation: Menu Planning E2E cell-menu suite (11 passed); modal safety contract tests (2 passed); Menu Planning typecheck and production build passed. No staging verification or deployment.
Deployment: none.
