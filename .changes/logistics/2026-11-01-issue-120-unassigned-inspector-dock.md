# 2026-11-01 — Dock and scroll the unassigned delivery inspector with visible focus (#120)

The legacy details inspector (queue item / stop / load, `aside.mock-inspector`) rendered inside the Journey Planner shell was sticky at the left edge below 1100px (landing under the planner), had no internal scroll so controls such as "Assign to vehicle" sat below the viewport, and showed no focus ring. It now docks on the right with a bounded height and internal vertical scroll; below 1100px it is a right overlay drawer (min(398px, 92vw)) that leaves the grid and never pushes below the planner; every control gets a visible `:focus-visible` outline on the Style Guide focus token. Escape/close behaviour is unchanged. CSS only (`shell.module.css`); the Run inspector and van-row stop chains are untouched.

Validation: Logistics typecheck; `npm test` 707/707; new Playwright spec at 820/1024/1280/1536px (fails on the old CSS, passes now); journey-planner-v3 project passes. `desktop.spec.ts` needs the Firestore emulator and was not run successfully. Physical tablet/staging not verified.
Deployment: none.
