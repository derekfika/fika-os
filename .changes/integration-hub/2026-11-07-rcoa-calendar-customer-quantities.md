# 2026-11-07 — Preserve Hospitality customer quantities in Calendar events

Hospitality Calendar mirror descriptions now use each CPU-routed Production Order line's customer quantity and unit. CPU production quantities remain unchanged and are not substituted into customer-facing Calendar text. Missing customer quantity/unit or stable line identity fails closed; non-CPU lines remain excluded. Titles use safe canonical client display fields, omit email-like values, fall back to the site label, and render canonical service enum separators as spaces. The Hot Fork Buffet regression preserves the 94-guest title, 90 Per person line, and current approved quote attachment/link.

Validation: `tests/cpux-mirror.test.ts` 11/11 passed; Integration Hub typecheck and production build passed. Full Hub suite: 999 passed, 120 skipped, 1 failed because the unchanged ADDR-001 test expects the unavailable sibling `fika-platform-specs` repository.
Deployment: none.
