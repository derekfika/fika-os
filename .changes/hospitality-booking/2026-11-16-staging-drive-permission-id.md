# 2026-11-16 — Correct staging Drive identity binding

Aligned Hospitality's staging Shared Drive service-account permission ID with the authenticated identity returned by Google. This restores the existing isolated quote PDF upload path; the approved staging root, Manager, sentinels and fail-closed verification remain unchanged. No production Drive access was added.

Validation: staging config test 4/4 passed. Authenticated staging UAT and deployment pending.
Deployment: none.
