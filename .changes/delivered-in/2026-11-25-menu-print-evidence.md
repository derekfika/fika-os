# 2026-11-25 — Check CPU evidence before generating site menus

Manual and release-event menu generation now require a current signed CPU packet bound to the publication and printable evidence for every allocated dish before contacting Drive. Historical packets with an explicit signed clear summary remain supported. Generic menus distinguish Contains and May contain and retain the recorded details.

Validation: 224 Delivered-In tests, typecheck and production build passed. The isolated standing-order emulator suite passed 6/7 on both this change and the starting main source. The existing CPU outage recovery assertion expected one delivery and observed zero. Hosted output and visual acceptance remain unverified.

Deployment: none.
