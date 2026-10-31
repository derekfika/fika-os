# 2026-10-29 — Munich RE booking-form catalogue and contextual minimum-order override

Munich RE now serves the products and prices from its live booking form (28 priced items, each classified against the company catalogue); the old CFC-derived rows are archived, not deleted. A reusable site/customer minimum resolver lowers items carrying the standard minimum of 8 to 5 for Munich RE and Gallagher, leaving One Angel Court ordinary bookings, other sites, fixed packs and genuine minimums unchanged. Enforced in shared validation and Hub ingestion/price trust. Munich RE room and collection-point model added (portal wiring pending).

Validation: new munich-re-minimums and munich-re-onboarding tests plus oac-catalogue-rules, hospitality-booking-service, brochure-company-mapping and related Hub suites pass; Hub typecheck shows only pre-existing hospitality-rotations errors. Hospitality portal UI, end-to-end CPU/Logistics and staging UAT not run.
Deployment: none.
