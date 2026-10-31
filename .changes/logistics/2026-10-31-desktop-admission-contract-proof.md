# 2026-10-31 — Prove desktop app access without van grants

Added a chained Hub admission → Logistics HTTP adapter/handler regression using non-admin identities with zero vehicle grants. It proves both-van desktop reads, View write denial, Manage planner writes, policy expiry/revocation and maintenance denial. PIN execution works with no Hub identity or grants and remains confined to its van and driver actions. Updated the authority note to distinguish current desktop/PIN policy from historical resource-only rules; runtime authorization is unchanged.

Validation: cross-app contract and PIN/middleware tests 22/22; Hub focused admission/authority tests 38/38; Logistics authority/access/driver tests 209/209. Governed validation passed: workflow 106/106, Hub 875 passed/115 skipped, Logistics 701/701, both typechecks and production builds. Exact-source hosted CI remains required.
Deployment: none; #103 remains open for authenticated staging acceptance. No live identity/grant/PIN, operational data, migration, recurring read or audit behavior changed.
