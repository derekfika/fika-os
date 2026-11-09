# 2026-11-09 — CPU run-sheet dialog visibility

Scoped the run-sheet dialog's flex layout to its native open state so closed dialogs retain browser visibility behavior. Added a Chromium regression for desktop, tablet and narrow layouts, backdrop/top-layer behavior, controls, Escape/Close and focus restoration. Configured the approved production CPU Drive owner/folder and existing DWD secret binding so signed materialisation can write to its governed destination.

Validation: focused CPU signing/retry and Drive configuration tests passed (41/41); `npm run test:dialog` passed; CPU typecheck passed. Hospitality CPU-default storage/config tests passed (15/15) and typecheck passed. Builds and exact-source CI pending. The browser regression uses production dialog CSS with a native-dialog fixture; React modal integration remains unverified.
Deployment: pending governed merge and production release.
