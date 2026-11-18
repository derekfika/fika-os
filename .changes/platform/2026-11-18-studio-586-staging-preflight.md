# 2026-11-18 — Inspect Studio staging provisioning without a rollout

Add a read-only preflight for the proposed staging backend, service account, Firestore database, traffic settings and custom-domain linkage. Studio stays outside the governed release target list until effective isolation, AUTHMOD and first-release checks are reviewed.

Validation: focused release policy and provisioning tests, plus a read-only staging preflight that reported the expected hold.
Deployment: none. No cloud resources or permissions changed.
