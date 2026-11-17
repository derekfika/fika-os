# 2026-11-17 — AUTHMOD All Sites Access

Added an audited, application-specific All Sites Access scope for operational identities. It resolves active OPLOCs dynamically while retaining the existing app assignment and action grants; revoking app admission also revokes the site scope.

Validation: focused AUTHMOD, OPLOC authorization and admin tests (58 passed); Hub typecheck and production build passed. Staging validation pending.
Deployment: none.
