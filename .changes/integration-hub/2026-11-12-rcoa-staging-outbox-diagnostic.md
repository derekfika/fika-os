# 2026-11-12 — Diagnose staging Calendar outbox inventory failures

The authenticated read-only Calendar outbox inventory now reports bounded operation names and safe Firestore error classifications on failure. Raw provider messages, customer records, and credentials are not returned or logged. Added regression coverage for classification, empty candidate queries, and the dedicated Hospitality Mirror composite-index contract.

Validation: focused outbox tests (10 passed), Hub typecheck, changed-file ESLint, and production build passed. Authenticated staging UAT initially identified the missing composite index for `fikaCpuXHospitalityMirrorOutboxV1`; after creating the exact two-field index in staging `(default)`, the read-only inventory returned HTTP 200 with zero records, no cursor, and no scheduler candidates. No Calendar delivery was invoked.
Deployment: Hub staging build `build-2026-11-12-003` at `0b525bfffb7846327b662211b3d7fcb548746ede`, 100% traffic. Staging-only Firestore index `CICAgJiUsZIK` is `READY`. No production change.
