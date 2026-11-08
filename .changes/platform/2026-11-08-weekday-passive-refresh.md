# 2026-11-08 — Weekday passive refresh window

Sets the shared passive dashboard refresh gate to weekdays from 06:00 through 15:59 Europe/London, with no passive requests outside that window or on weekends. The existing 15-minute Logistics minimum remains in force. Manual refreshes, initial loads, user actions, and pending-operation convergence stay available.

Validation: shared UK policy tests passed (5/5); Logistics typecheck passed. DST, visibility, in-flight, slower minimum interval and standalone CPU dashboard policy are covered.
Deployment: none.
