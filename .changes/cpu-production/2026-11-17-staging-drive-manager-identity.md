# 2026-11-17 — Align staging Drive Manager identity

Updated CPU staging's Drive allowlist to the verified live Manager permission ID while retaining the dedicated service account. Production configuration, permissions and Calendar write controls remain unchanged.

Validation: 16 focused CPU buffet/lineage/staging-config tests passed; full CPU typecheck/build passed. The broader suite was stopped after unrelated notification/outbox test timeouts. Staging rollout is pending.
Deployment: pending.
