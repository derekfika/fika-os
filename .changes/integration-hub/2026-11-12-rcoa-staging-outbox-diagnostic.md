# 2026-11-12 — Diagnose staging Calendar outbox inventory failures

The authenticated read-only Calendar outbox inventory now reports bounded operation names and safe Firestore error classifications on failure. Raw provider messages, customer records, and credentials are not returned or logged. Added regression coverage for classification, empty candidate queries, and the dedicated Hospitality Mirror composite-index contract.

Validation: focused tests, Hub typecheck, changed-file ESLint, and production build passed. Staging diagnosis and deployment pending.
Deployment: none.
