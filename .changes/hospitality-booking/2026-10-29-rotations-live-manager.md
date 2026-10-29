# 2026-10-29 — Authenticated Hospitality Rotations manager

Added the protected `/rotations` manager, authenticated Hub proxy integration, canonical picker workflow, draft/version review and publication controls. Search uses the bounded Hub resource response in memory; the existing fixture preview stays separate.

Validation: Hospitality tests (364 passed), typecheck and build passed. Browser staging workflow is pending the integrated PR rollout.
Deployment: not deployed by this change; a staging foundation rollout is separate.
