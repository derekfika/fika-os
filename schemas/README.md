# Schemas

Canonical schemas are a Stage 5 deliverable. They implement accepted Business Decision Records and must not invent business meaning.

## Current status

- [Pack 1](pack-1/README.md) contains adopted foundational identity and Operational Location component schemas.
- [Pack 2](pack-2/README.md) contains Operational Capability, Configuration, Role, Responsibility, Assignment, AUTHMOD and Permission schemas.
- [Pack 3](pack-3/) contains adopted Service Domain component schemas.
- [Pack 4](pack-4/) contains adopted Booking Domain component schemas; it does not contain one complete Booking aggregate schema.
- [Pack 5](pack-5/README.md) contains the adopted Event Domain schema and fixtures.
- [Pack 6](pack-6/README.md) contains adopted Production Order, Production Line, routing and change-record schemas.
- [Pack 7](pack-7/README.md) contains adopted Mobilisation, phase-plan, task and readiness-assessment schemas.
- [Pack 8](pack-8/README.md) contains adopted Brand Variation, Brand Assurance Record, Waste Event and Waste Disposition schemas.
- Packs 1 through 8 form the completed, integrated and committed Stage 5 baseline. Fresh repository-wide validation passed on 2026-07-25.
- “Draft,” “ready for review,” “ready for integration” and similar labels inside older Pack-processing records describe their historical processing stage. They do not override the completed, integrated and adopted Stage 5 baseline.
- Existing pre-Pack `FikaBooking` schemas and fixtures remain supporting draft evidence, not completed canonical contracts.
- Canonical use requires traceable BDR authority, validation and repository integration under the established Stage 5 workflow. Implementation also requires a governed repository-wide schema-versioning convention; that prerequisite remains unresolved.

See [Stage 5 — Schema Design](../docs/stages/stage-5-schema-design.md) and [documentation governance](../docs/documentation-governance.md).
