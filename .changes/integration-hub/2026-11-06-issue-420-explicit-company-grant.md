# 2026-11-06 — Require an explicit company-wide Hospitality Admin grant

Hub now requires a direct, currently effective Hospitality Admin grant for late standalone and grouped booking amendments. AUTHMOD uses the same company-wide grant control for eligible accounts regardless of Superuser status. The booking audit records the grant ID and version used in the transaction.

Validation: Focused Hub authorization and Hospitality consumer tests, the isolated Firestore booking test, and both app typechecks and builds passed. Authenticated browser UAT was unavailable.
Deployment: None.
