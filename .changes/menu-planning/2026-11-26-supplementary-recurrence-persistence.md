# 2026-11-26 — Persist supplementary menu recurrence in Firestore

Menu Planning saves recurring breakfast and other supplementary menu schedules with their occurrences in a Firestore transaction. Future amendments and discontinuations preserve their actor and audit history. Opening a planning week materialises missing occurrences only for services the actor can manage at every target site. Retrying the same service week preserves its identity and existing draft.

Recurrence settings use a dedicated settings document, so older slot-settings writers cannot erase them. Existing weeks and publications stay readable. An absent settings document represents an empty series list. Historical occurrences alone do not establish that a series is still active.

Validation: the full Menu Planning suite passed (592 passed, five emulator-dependent skips); the isolated Firestore SDK lifecycle test passed; typecheck passed. Governed validation is in progress.
Deployment: none; no staging deployment was performed.
