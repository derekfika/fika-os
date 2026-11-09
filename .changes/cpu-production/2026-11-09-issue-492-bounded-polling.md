# 2026-11-09 — Bound allergen materialisation status polling

Automatic CPU allergen release status checks now back off from 2.5 seconds to 15 seconds, stop after two minutes, and pause while the browser tab is hidden. Persistent nonterminal or failed states remain actionable through the existing lineage-checked Retry action. A successful HTTP status response is not treated as proof that materialisation completed.

This change addresses the polling storm portion of issue #492 only. The production outbox failure, signed Hospitality lineage, production configuration, and live release state still require authenticated read-only production diagnosis before any repair or deployment.

Validation: Focused CPU allergen, signing-lineage, release retry, durable-outbox and packet tests passed (70 tests); Hospitality signed-artifact access tests passed (5 tests). CPU typecheck and production build passed. The full CPU suite was attempted; Firestore emulator route tests failed to start their isolated emulator within 90 seconds in this environment.

Deployment: Not deployed. Production read-only GCP access is unavailable here, so the outbox cause and serving revisions remain unverified.
