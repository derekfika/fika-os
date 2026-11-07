# 2026-11-07 — Beverage staging preview visual refinement

Refine the approved `/mock` preview with token-backed header, line navigation and lifecycle icons, compact headings and numeric typography, and clear staging-preview and provisional-imagery labels. Expose selected view controls, fix the tablet list layout, and add keyboard focus trapping, Escape and focus return to the import demonstration. The preview remains in-memory and has no backend or external effects.

Style Guide compliance: DEVIATION — the approved reference uses mixed-case display headings; the supplied Vim Heavy face renders them uppercase, so this preview retains Gilroy Bold for those headings pending brand review. Other colours and interface fonts use the shared tokens and approved faces.

Validation: typecheck, 10 unit tests, build, local desktop and tablet Chromium review, keyboard dialog checks, responsive width checks, no external requests, and 1448 × 1086 side-by-side comparisons. See `visual-evidence/README.md` for remaining visual differences.

Deployment: none in this task.
