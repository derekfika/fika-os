# 2026-11-06 — Separate CPU run-sheet columns

CPU on-screen and A4 collection sheets now show packing, category, dish name, and portions in distinct wrapping columns while retaining canonical slot order and packing controls. Non-Menu services retain the existing customer ordered quantity heading.

Validation: focused CPU print tests passed (13/13), Chromium A4 suite passed (8/8), CPU typecheck passed, production build passed, and `git diff --check` passed. The generated canonical 29-slot PDF was visually checked; all four columns fit, labels wrap cleanly, and two-page pagination remains intact.
Deployment: none.
