# 2026-11-13 — Validate confirmed buffet choices at Hub

The Hub validates one meat or fish main plus one vegetarian or vegan main, at least 12 portions for each main, and an exact combined guest total. Gold and Silver both require three distinct salads; Gold takes two distinct desserts and Silver one. Odd guest counts are valid, with no invented salad or dessert quantities. Current v2 writes require the rules version; historical v1 evidence remains available for replay and quotes. Effective site catalogue prices and the existing booking, quote, audit, explicit CPU handoff and idempotency boundaries remain authoritative. Customer selector submission is still closed pending separate live-order approval.

Validation: focused rules, price, quote and legacy booking tests; isolated Firestore emulator handoff/replay test; Hub typecheck and build. No operational data write or migration.

Deployment: none.
