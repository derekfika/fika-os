# 2026-10-30 — Ad-Hoc CPU dashboard scope

Show orders from the canonical `production-order:v1:ad-hoc:` namespace in CPU Hospitality and All production only, with an Ad-Hoc source label in rows, day view, calendar cards, and order details. Totals use Hospitality display grouping while preserving source IDs, requested category, line routing, quantities, lifecycle and fulfilment behavior.

Validation: focused regression tests passed (31/31); full CPU suite passed (494 passed, 2 skipped); CPU typecheck and production build passed; governed validation passed (96/96 workflow tests and affected CPU test/typecheck/build gates); `git diff --check` passed.
Deployment: none.
