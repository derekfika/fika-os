# 2026-11-07 — Verify Calendar bindings before mirroring

Shared Calendar transport now exposes CalendarList-based organiser access verification and confirms the exact delegated organiser on event reads and writes. Hospitality no longer accepts duplicated mailbox subjects from generic Calendar configuration; Delivered-In retains its independent binding.

Validation: Hub Calendar mirror tests passed, including Calendar access-role failure and quote attachment checks. Full affected-consumer checks pending.
Deployment: none.
