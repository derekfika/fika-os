# 2026-11-07 — Adapt Beverage admission to a verified Hub request

Verify the canonical FIKA session cookie before reading an existing UID binding and current AUTHMOD and OPLOC packages in one read-only Firestore snapshot. Deny missing or stale packages without recovery or publication.

Validation: 1,005 Hub tests and 45 Firestore emulator tests passed, with 120 conditional unit skips and one emulator skip. Hub typecheck and build passed. The existing Hub lockfile audit findings remain a separate release concern.

Deployment: None. The adapter has no HTTP route or live registry provisioning.
