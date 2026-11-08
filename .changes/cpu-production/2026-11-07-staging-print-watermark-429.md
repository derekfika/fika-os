# 2026-11-07 — Staging CPU print warning for #429

Added a server-derived staging marker and a repeated `STAGING / NOT FOR OPERATIONAL USE` page-margin warning to CPU run sheets, totals, signed allergen HTML, and published-menu allergen matrices. The direct TIA print page uses a staging-only named page rule. Production print output remains unchanged.

Validation: `fika validate --base origin/main` passed (157 workflow tests, 614 CPU tests passed, 4 skipped); CPU typecheck and production build passed. Chromium and Poppler visually verified two-page PDFs from the shared CPU print helper and TIA print page, with the warning on both pages. Drive, email, and non-CPU external-effect isolation remain outside this change.
Deployment: not yet deployed.