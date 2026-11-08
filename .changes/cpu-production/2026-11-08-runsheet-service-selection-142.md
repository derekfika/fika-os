# 2026-11-08 CPU run sheet service-aware printing (#142)

Date: 2026-11-08
Task: CPU run sheet modal refactor (#142)

- Complexity: Medium. Recommended model: Luna. Reason: scoped CPU modal and selection behavior using existing canonical production orders and print engine.
- The run sheet dialog now groups date/A4 options, service filters, searchable destinations, and a print summary. Global services use canonical production category and source routing; per-destination toggles can explicitly include or exclude services. Fresh-data verification remains required before printing, and A4 pagination remains in the existing engine.
- Fixture-only desktop, tablet, and mobile comparison screenshots were captured and approved before implementation. No production data was used in visual fixtures.
- Validation: focused run-sheet/day-print tests (14/14), Chromium PDF pagination/watermark tests (16/16), CPU typecheck and production build pass. Exact-source GitHub Actions passed on PR commit `396161f`: CPU suite 620 tests (616 passed, 4 skipped, 0 failed), shared contract 26/26, governed workflow suite 163/163, Windows workspace checks, and production build.
- Style Guide compliance: PASS for the approved fixture review at desktop, tablet, and mobile widths; implementation uses the same FIKA tokens, typography, spacing, semantic status colors, visible focus rings, and stacked layout.
- Deployment: not deployed. Staging and production promotion pending governed qualification; owner visual approval remains required before production promotion.
