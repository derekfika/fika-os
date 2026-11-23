# 2026-11-23 — RCoA invoice summary authority and data

Adds a bounded, attributed RCoA booking read for invoice reporting, checks current saved quote totals, and requires direct explicit site-scoped Hospitality Invoice Report authority or existing Hospitality Admin authority. The special permission cannot be delegated. Real All Day event titles come from the canonical `Event:` note; rows without a recorded title are labelled accordingly rather than using an event type. Unsupported financial rows are surfaced for review and excluded from the subtotal.

Validation: focused report and AUTHMOD tests 11/11; Hub typecheck and production build passed. Full local Hub tests reported 1,127 passed, 131 emulator tests skipped, plus one unrelated address-workflow failure because the sibling `fika-platform-specs` checkout is unavailable.
Deployment: none.
