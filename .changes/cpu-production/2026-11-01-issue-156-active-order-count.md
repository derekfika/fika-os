# 2026-11-01 — Issue 156 active order counts

Exclude cancelled and otherwise withdrawn production orders from the shared filter summary counts while retaining cancellation notices in the calendar and attention workflow. This corrects CPU active-demand reporting without changing operational records or filtering behavior.

Validation: focused production-view-filters test, CPU typecheck/build, and governed validation (record actual results before merge).
Deployment: none.
