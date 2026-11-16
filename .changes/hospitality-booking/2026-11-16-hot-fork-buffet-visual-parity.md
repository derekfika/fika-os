# 2026-11-16 — Hot Fork Buffet visual parity

Reworked the existing buffet selector into the supplied full-screen RCoA booking layout, with package pricing, compact dish choices, portion controls, selection summary and persistent booking actions. Existing buffet rules and save/amend behavior remain server-authoritative; live ordering stays gated.

Validation: 478 Hospitality tests, typecheck and production build passed. `fika validate` passed 164 workflow checks plus Hospitality tests/typecheck/build. Protected merge gate passed; desktop, tablet and mobile layouts reviewed against the supplied mockup.
Deployment: Hospitality production rollout `build-2026-11-16-002` for merge `edf2bcc6e20179f484bba029e88705a76f928d65` succeeded at 100%; release smoke returned HTTP 200. Live buffet selection remains disabled (production config `false`; selection endpoint returned HTTP 404).
