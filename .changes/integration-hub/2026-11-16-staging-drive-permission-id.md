# 2026-11-16 — Correct staging Drive identity binding

Aligned Hub's staging Shared Drive service-account permission ID with the authenticated identity returned by Google so the existing quote PDF status verifier can validate PDFs uploaded to the approved staging root. Isolation, file size/type, ancestry and production-denial checks remain unchanged.

Validation: staging config and quote PDF verifier tests 7/7 passed. Authenticated staging UAT and deployment pending.
Deployment: none.
