# 2026-11-25 — Prepare verified product menu publication

Add a staging pilot publication endpoint for saved product drafts. It binds each ordered dish reference to its exact archived revision and current CPU verification, preserves the draft and legacy publication records, and records one immutable package plus a retryable Hub delivery. A read-only draft preview endpoint resolves customer-safe details and current site/date price and choice rules. Product menu activation remains a separate Hub command.

Validation: 95 Studio unit tests, 8 isolated Studio Firestore tests and Studio typecheck passed.
Deployment: none.
