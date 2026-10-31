# 2026-10-29 — Authenticated Hospitality Rotations manager

Added the protected `/rotations` manager, authenticated Hub proxy integration, canonical picker workflow, draft/version review and publication controls. Search uses the bounded Hub resource response in memory; the existing fixture preview stays separate.

Validation: Hospitality tests (364 passed), focused Rotations UI tests (9 passed), typecheck and build passed. Staging `/rotations` renders the protected sign-in state; save/reorder/publish browser checks await an authenticated FIKA session.
Deployment: verified on Hospitality staging build `build-2026-10-29-002`, source `773d4229481de4e388782b389521968b5909e94d`.
