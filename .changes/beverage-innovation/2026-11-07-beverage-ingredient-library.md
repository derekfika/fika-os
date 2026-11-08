# 2026-11-07 — Add a local ingredient library adapter

Provide a fixture-only, read-only product search using the Hub Food Data v1 ingredient snapshot contract. Verify the pinned version and both compressed and JSON hashes. Keep duplicate products separate with snapshot-scoped source row provenance. The route uses local View authority and does not supply recipe costs or allergen declarations.

Validation: All 37 app tests and six isolated Firestore emulator tests passed, along with typecheck and production build. Tests cover Hub-format conformance, malformed evidence and local-only access. Both dependency audits found zero vulnerabilities.

Deployment: None. Hosted Food Data access remains gated.
