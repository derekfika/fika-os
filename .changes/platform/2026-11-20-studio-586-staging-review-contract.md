# 2026-11-20 — Pin the Studio-to-CPU staging review contract

Bind the review interface to the staging CPU audience and the existing dedicated Studio runtime identity. The association is verified without additional database grants, service-account keys, shared secrets or impersonation. The CPU endpoint separates read-only readiness checks from submitting a new review.

Validation: CPU and Studio transport contract tests cover disabled environments, wrong identities and subjects, and bounded inputs.
Deployment: none.
