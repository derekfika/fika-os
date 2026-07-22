# Pack

Pack 4 ? Booking Domain

# Date

2026-07-14

# Domain(s)

Booking, Production, Commercial, Finance, Food Safety and source-reference provenance.

# What this Pack clarified

Pack 4 clarifies the minimum business decisions required to progress the next FikaBooking revision: mandatory service start time, production-compatible quantities and units, allergen/customer disclosure obligations, immutable accepted price snapshots, VAT and rounding direction, amendment/cancellation/decline audit expectations, and stable source references.

# Major business decisions

Seven Booking-domain BDRs were processed. Their canonical Decision sections were preserved from the source documents.

# Cross-document observations

The pack reinforces separation between commercial booking state, production needs, pricing snapshots, audit history and source provenance.

# Concepts intentionally deferred

Unit catalogues, conversion-rule catalogues, exact allergen/person/item reference granularity, high-risk amendment thresholds and precise VAT rounding mechanics beyond round-up preference remain future refinement items where business authority is required.

# Schema observations

Seven draft business schemas were generated. They are candidate contracts only and should not be treated as adopted production schemas.

# Workflow improvements discovered

None recorded here. The active workflow is frozen; any observations belong in the later Stage 5 Workflow Refactor Plan.

# Risks avoided

The pack avoids inventing provider-specific payloads, database models, authority assignments, definitive unit catalogues or unresolved allergen policy.

# Evidence produced

- Number of BDRs: 7
- Number of Schemas: 7
- Number of Fixtures: 14
- Validation summary: 0 schema validation failures; 7 valid fixtures passed; 7 invalid fixtures failed as expected.

# Lessons learned

The Booking domain is a convergence point for customer intent, production needs, finance controls, food-safety disclosure and provenance. It benefits from narrow schemas that preserve the approved decision without pretending unresolved operational catalogues are already settled.

# Future domain candidates

Production conversion catalogues, allergen disclosure catalogues, amendment approval policy and source-channel adapter metadata may need future governed treatment.

# Recommendations for the next Pack

Continue using approved Decisions as the boundary for schema design. Do not adopt unresolved catalogues or thresholds until the relevant business owner approves them.
