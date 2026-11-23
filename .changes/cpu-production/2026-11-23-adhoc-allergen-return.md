# 2026-11-23 — Durable Ad-Hoc allergen checker return

CPU stages current and revoked Ad-Hoc checker metadata through the durable propagation outbox after release materialization and on revocation paths. Delivery carries release lineage and both valid signer details, never a Drive URL or file id. CPU exposes an internal token-gated live verification and hash-checked PDF proxy that refuses stale, revoked, amended, cancelled, or invalid releases.

Validation: On the refreshed source, `npm run typecheck`, CPU unit suite (657 passed, 0 failed, 6 skipped), targeted checker/PDF/outbox tests (25/25 passed), and `npm run build` passed. Windows `npm run test:emulator` did not produce the expected temporary PDF (`PDF_RENDERER_ERROR`), so its local PDF-backed signing acceptance is unverified; the original-head GitHub CPU emulator job passed, and the refreshed-head exact-source gate is pending. Style Guide compliance: PASS (CPU UI unchanged).
Deployment: none.
