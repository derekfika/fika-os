# 2026-11-26 — Persist supplementary menu recurrence in Firestore

Menu Planning saves recurring breakfast and other supplementary menu schedules with their occurrences in a Firestore transaction. Future amendments and discontinuations preserve their actor and audit history. Opening a planning week materialises missing occurrences only for services the actor can manage at every target site. Retrying the same service week preserves its identity and existing draft.

Recurrence settings use a dedicated settings document, so older slot-settings writers cannot erase them. Existing weeks and publications stay readable. An absent settings document represents an empty series list. Historical occurrences alone do not establish that a series is still active.

Validation: governed `fika validate` passed, including the full workflow suite, all 592 Menu Planning tests (five emulator-dependent skips), typecheck, and production build. The isolated Firestore SDK recurrence lifecycle test also passed.
Deployment: none; no staging deployment was performed.
