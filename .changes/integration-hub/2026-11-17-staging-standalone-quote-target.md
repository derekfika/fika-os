# 2026-11-17 — Route standalone RCoA staging quotes to the isolated folder

In staging, standalone RCoA quote saves now use the approved staging Quotes child returned from Hub configuration. Missing staging folder configuration fails closed; other sites and production retain their existing dashboard destinations. The existing Drive ancestry, membership and post-save PDF verification remain in force.

Validation: focused quote destination/PDF tests passed (12/12); Hub typecheck passed. Full affected app CI and staging acceptance pending.
Deployment: pending staging validation; production unchanged.
