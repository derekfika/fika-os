# Pack 8 BDR-to-Schema Traceability

## Brand Variation

| Schema element | Authority | Treatment |
|---|---|---|
| stable variation identity | schema governance; cohesion history principle | Separates a governed variation and its history from base FIKA branding. |
| scope | BRAND-001; LOC-001; SVC-001 | Client, Operational Location or Service reference; downstream presentation consumers are not direct variation owners. |
| basis | BRAND-001 | Client agreement, co-branding arrangement or white-labelled Service. |
| description and elements | BRAND-001 | Captures deliberate logo, colour, imagery or messaging variation without owning Media assets. |
| documentation reference | BRAND-001 | Mandatory because every variation must be documented. |
| Brand Assurance Record references | BRAND-001; Stage 5 governed clarification | At least one mandatory record identifying what was verified against the applicable Brand Standard. |
| authorisation references | BRAND-001; Stage 5 governed clarification | Separate Marketing and Brand approval references identify who authorised the variation without defining another workflow. |
| effective period | CFG-002; cohesion history principle | Dated variation history without silent overwrite. |

## Brand Assurance Record

| Schema element | Authority | Treatment |
|---|---|---|
| stable assurance identity and Brand Variation reference | BRAND-001; Stage 5 governed clarification | Preserves assurance separately from the variation and approvals. |
| Brand Standard reference | Stage 5 governed clarification | Identifies the applicable standard used for review. |
| verified items | Stage 5 governed clarification | Records what was verified without inventing a detailed checklist. |
| review attribution | Authority Model; ROLE-002 | Assignment-based reviewer and review timestamp. |

## Waste Event

| Schema element | Authority | Treatment |
|---|---|---|
| stable event identity | WASTE-001; schema governance | Identifies one Waste event independently of reporting projections. |
| category | WASTE-001 | Food or operational Waste. |
| Operational Location | WASTE-001; LOC-001 | Mandatory attribution to the responsible location. |
| occurrence time | WASTE-001 event meaning; audit separation | Distinguishes when Waste occurred from when it was recorded. |
| quantity amount and Measurement Catalogue reference | WASTE-001; Stage 5 governed clarification | Positive amount plus a reference to the Operations-owned catalogue; values are not hardcoded. |
| reason | WASTE-001 | Required textual reason pending a future approved catalogue. |
| Waste Disposition reference | WASTE-001; Stage 5 governed clarification | Links to the separate immediate operational outcome record. |
| recording assignment | WASTE-001; Authority Model; ROLE-002 | Attributable location recording without named-person governance. |
| provenance and audit | cohesion and schema governance | Preserves source authority, version and attributable history. |

## Waste Disposition

| Schema element | Authority | Treatment |
|---|---|---|
| stable disposition identity and Waste Event reference | WASTE-001; Stage 5 governed clarification | Separates the immediate outcome from the Waste Event and later Improvement Action. |
| immediate operational outcome | Stage 5 governed clarification | Required description of what happened operationally to the Waste. |
| recording attribution | Authority Model; ROLE-002 | Records when and by which assignment the disposition was recorded. |

## Deferred boundary

Improvement Action is a separate business concept for later changes arising from analysis. Its detailed domain is deferred, so Pack 8 creates no schema or embedded Improvement Action fields.

## Dependency warning

Pack 8 references Pack 2 Configuration, Role and Authority concepts. Their BDRs are repository-visible, but Pack 2 schemas are not currently integrated, so Pack 8 uses stable identity references only.
