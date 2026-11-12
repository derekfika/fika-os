# 2026-11-12 — Production Totals print workflow

Production Totals now use the Run Sheet date, service and destination selection flow. The print action refetches canonical orders and pauses with a review warning when the selected evidence changes. Totals retain the existing aggregate quantities and units, with FIKA A4 layouts, canonical menu order, Core Salad labels and continuation pages.

Validation: focused totals/run-sheet tests, browser dialog test, Chromium print regression, CPU typecheck and build. Reference PDFs were not present in the attachment directory, so visual comparison against Brian's supplied PDFs remains unavailable.
Deployment: none.
