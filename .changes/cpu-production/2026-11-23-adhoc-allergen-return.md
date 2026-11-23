# 2026-11-23 — Durable Ad-Hoc allergen checker return

CPU stages current and revoked Ad-Hoc checker metadata through the durable propagation outbox after release materialization and on revocation paths. Delivery carries release lineage and both valid signer details, never a Drive URL or file id. CPU exposes an internal token-gated live verification and hash-checked PDF proxy that refuses stale, revoked, amended, cancelled, or invalid releases.

Validation: `npm run typecheck`, CPU unit suite (655 passed, 0 failed, 6 skipped), and targeted checker/PDF/outbox tests (25/25 passed); `npm run build` passed. `npm run test:emulator` was attempted but failed while materializing a PDF in the existing signing concurrency emulator (`PDF_RENDERER_ERROR`; generated temp PDF was absent). The test failure is environment-related and leaves full PDF-backed emulator acceptance unverified. Style Guide compliance: PASS (CPU UI unchanged).
Deployment: none.
