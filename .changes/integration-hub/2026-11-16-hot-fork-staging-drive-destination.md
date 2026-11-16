# 2026-11-16 — Isolate staging group quote destination

Allow the RCoA group quote workflow to use the verified dedicated staging Drive identity and the configured Quotes folder beneath the approved staging root. Production folder resolution and generic stored-link redaction remain unchanged; the staged destination is checked for ancestry, Shared Drive identity, folder state, and write capability before quote persistence begins.

Validation: focused group quote and staging containment tests, Hub typecheck, and Hub production build passed. Authenticated staging quote/CPU acceptance is pending deployment and UAT.
Deployment: pending governed staging release.
