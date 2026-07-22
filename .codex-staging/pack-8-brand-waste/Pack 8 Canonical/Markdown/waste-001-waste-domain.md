# WASTE-001: Waste as a Business Domain

- **Decision ID:** WASTE-001
- **Workbook Decision ID:** DEC-WASTE-001
- **Status:** Draft
- **Date:** 2026-07-12T08:33:47.768Z
- **Decision owner:** Derek / Operations
- **Related domains:** Waste

## Context

Business discovery asked: **What confirmed problem, owner and record would justify Waste as a first-class domain?**

Before approval, the recorded evidence stated: “Waste is a discovery domain with no confirmed domain evidence or owner.” The question was recorded as a validation decision with unknown repository confidence before approval.

## Decision

Waste is a first-class business domain because FIKA actively measures and manages food and operational waste as part of its sustainability, commercial and continuous improvement objectives. The domain records waste events, quantities, reasons, locations and outcomes to support reporting, trend analysis and operational improvement. Ownership should sit with Operations, with individual locations responsible for recording waste and central reporting used to identify opportunities to reduce cost and environmental impact.

## Business rationale

FIKA needed one authoritative answer to the ambiguity recorded in [docs/platform-domain-map.md](../platform-domain-map.md), specifically the section `Domain Catalogue — Waste`. Without a canonical decision, later documents or applications could interpret this subject differently.

The approved decision establishes a shared business rule. The alternative—leaving the matter implicit or allowing each implementation to decide independently—was rejected because it would recreate competing business meaning. Historical and supporting material remains evidence, but it cannot override this decision.

## Positive consequences

- FIKA now has a stable, human-approved rule for this aspect of Waste.
- It provides stable business meaning for later BDR, schema and architecture work.
- Stage 5 schemas and Stage 6 architecture can trace their treatment of this subject to one canonical source.
- Application and provider behaviour cannot silently redefine the decision.

## Trade-offs

- The decision constrains local interpretation where consistency is required.
- Any future change must preserve history and use a superseding or amended BDR rather than silently editing downstream documents.
- The decision deliberately leaves technology, storage and API design to later stages.

## Implementation implications

Future Waste BDR, schema and reporting work must treat Waste as an Operations-owned domain while keeping source-domain records separate.

This BDR does not select a database, API, provider, application design or deployment approach.

## Related decisions

- None — this is a foundational decision with no direct workbook dependency.

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-WASTE-001, sourced from `Questions!21`.
- [docs/platform-domain-map.md](../platform-domain-map.md) — **Canonical**; `Domain Catalogue — Waste`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

There are no open discovery questions for this decision. During BDR review, evidence and explanatory text should be checked without altering the Decision section. Later schema, architecture and implementation work must resolve technical detail while preserving this approved business meaning.

## Stage 5 governed clarification

Approved by Derek on 2026-07-15 for Pack 8 processing. The original Decision above and the BDR's Draft metadata remain unchanged.

- Waste quantity comprises a positive numeric quantity and a measurement unit referenced from the Operations-owned Measurement Catalogue.
- Measurement Catalogue values remain deferred and are not hardcoded in the Waste domain.
- Waste Disposition records the immediate operational outcome of a Waste Event.
- Improvement Action records any later business change arising from analysis of a Waste Event.
- Waste Disposition and Improvement Action remain separate business concepts.
- The detailed Improvement Action domain remains deferred and is not introduced into this Pack.
