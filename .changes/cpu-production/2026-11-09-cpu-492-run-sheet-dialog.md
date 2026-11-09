# 2026-11-09 — CPU run-sheet dialog visibility

Scoped the run-sheet dialog's flex layout to its native open state so closed dialogs retain browser visibility behavior. Added a Chromium regression for desktop, tablet and narrow layouts, backdrop/top-layer behavior, controls, Escape/Close and focus restoration.

Validation: `npm run test:dialog` passed; `npm run typecheck` passed; `npm run build` passed. Browser regression uses the production dialog CSS and a minimal native-dialog fixture; authenticated production UI verification remains outside this task.
Deployment: none.
