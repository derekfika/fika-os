# 2026-11-05 — Grab & Go Scheduler OIDC authentication

Direct Google OIDC authentication now protects the bounded standing-order generator and
handoff-recovery endpoints. It checks Google's RS256 signature, issuer, time claims,
route-specific audience, verified email, and the exact environment-bound Scheduler
service account. Existing order generation and outbox semantics remain unchanged.

Validation: Delivered-In suite passed (209/209), including OIDC acceptance/rejection,
exact audience/identity and environment pairing; UK BST/GMT cutoffs, duplicate and
concurrent execution, manual precedence, cancellations, and handoff retries. Typecheck
and production build passed after correcting the service-account ID to Google's
30-character limit. No service account or Scheduler job was created by the rejected
invalid-ID call.
Deployment: Not deployed. Production Grab & Go jobs remain absent; CPU and Logistics
recovery jobs remain paused. Shared-token rotation and old Scheduler header removal are
not complete.
