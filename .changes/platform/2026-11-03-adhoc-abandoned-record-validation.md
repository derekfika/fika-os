# 2026-11-03 — Validate governed abandoned release records

- **Summary:** Accept only evidence-backed abandoned release records with preserved first-release or previous-good lineage, so the governed Ad-Hoc first-release retry path can continue after reconciliation.
- **Validation:** `node --test tools/workflow/policy.test.mjs tools/workflow/recovery.test.mjs` — 32/32 passed.
- **Deployment:** Pending exact-head CI and governed integration; no production rollout submitted by this change.
