# Pack

Pack 4 ? Booking Domain

# Date

2026-07-14

# Domain(s)

Booking, Production, Commercial, Finance, Food Safety and source-reference provenance.

# What this Pack clarified

Pack 4 resolves the key FikaBooking revision blockers represented by BOOK-001 through BOOK-007: mandatory service start time, booking-item quantity/unit semantics, allergy and allergen disclosure, immutable accepted price snapshots, VAT and rounding direction, audited amendments/cancellations/declines, and channel-neutral source references.

# Major business decisions

Seven repository BDRs were processed. Their Decision sections were preserved exactly.

# Cross-document observations

The pack reinforces that Booking owns commercial and service intent while Production, parser detail, provider state and operational projections remain separate.

# Concepts intentionally deferred

Definitive unit catalogues, conversion-rule catalogues, exact allergen allocation granularity, high-risk amendment thresholds and precise VAT rounding mechanics beyond the approved preference remain deferred.

# Schema observations

Seven draft business schemas were generated. They are candidate contracts only and should not be treated as adopted schemas.

# Workflow observations

None recorded. The active workflow is frozen.

# Risks avoided

The pack avoids inventing business catalogues, approval thresholds, provider payloads, implementation models or parser-specific canonical fields.

# Evidence produced

- Number of BDRs: 7
- Number of Schemas: 7
- Number of Fixtures: 14
- Validation summary: 0 validation failures; 7 valid fixtures passed; 7 invalid fixtures failed as expected.

# Lessons learned

The Booking domain can progress substantially from the approved BDRs, but adoption still needs explicit treatment of catalogues, thresholds and arithmetic rules that the BDRs intentionally leave to later governed work.

# Future domain candidates

Production conversion catalogues, allergen disclosure catalogues, amendment approval policy and source-channel adapter metadata.

# Recommendations for the next Pack

Continue generating schemas only from approved business meaning and keep unresolved catalogues out of canonical contracts until business authority approves them.
