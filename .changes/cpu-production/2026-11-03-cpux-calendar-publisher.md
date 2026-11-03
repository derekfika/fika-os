# 2026-11-03 — CPUX Calendar publisher and bounded backfill

CPU canonical Production Orders with explicitly routed Sandwiches lines now publish to the CPUX calendar through the CPU durable outbox. Events use a stable canonical-order ID, update or cancel idempotently, contain no attendees, attachments or booking notes, and use Europe/London service times. An internal-token protected scanner sends existing orders for explicit date ranges through the same outbox in bounded 31-day/25-order batches; repeated scans do not create another event. The scanner is outbound only and does not import Calendar events into FIKA OS.

Validation: governed workflow validation passed; CPU suite passed (552 tests: 548 passed, 4 skipped); focused publisher/outbox regressions passed (26 passed); CPU typecheck and production build passed.
Deployment: none. Runtime requires `FIKA_CPUX_CALENDAR_ID` and Calendar write access for the CPU runtime identity; no live Calendar writes were performed.
