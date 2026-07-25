# Brand Boundary and Presentation System

## Status

Stage 6 supporting specification governed by BRAND-001, Pack 8 Human Decision Resolution and [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md). Brand business meaning belongs to the Brand domain, not FIKA Core.

## Governed Brand records

Evidence establishes:

- approved FIKA branding is the default;
- a deliberate Brand Variation may support an agreed client, co-brand or white-labelled context;
- every governed variation includes at least one Brand Assurance Record;
- Marketing and Brand approval identifies authorisation;
- assurance records what was checked against the applicable Brand Standard;
- accessibility, usability, quality and consistency must not be compromised.

The Brand domain owns Brand Variation and Brand Assurance Record. The complete Brand Standard catalogue, lifecycle and ownership details are not yet fully governed.

## Configuration relationship

Configuration may select an authorised, effective Brand Variation for a governed scope. Configuration does not create the variation, redefine the Brand Standard or grant approval authority. “Site override” is expressed as an Operational Location-scoped configuration only where the relationship is governed.

## Presentation concerns

Applications may render logos, colour palettes, typography, imagery and messaging from an approved brand view or asset reference. Rendering components are reusable presentation assets, not canonical Brand records.

## Media and asset relationship

Media storage, transformation and delivery are separate concerns. A Brand record may reference approved assets without owning their binary storage. Future Media capability must not redefine Brand approval or assurance.

## Events

An Event may use an authorised Brand Variation or presentation configuration. This does not move Event ownership into Brand or create a new Event-brand business concept without a BDR.

## White-labelling

White-labelling is an approved Brand Variation, not an application fork. It must remain deliberate, documented, assured and authorised under the governed business scope.

## FIKA Core role

Core may standardise stable references and configuration-resolution contracts used to retrieve an authorised brand view. Core does not own brand assets, standards, variations, approval or rendering rules.

## Open questions

- Canonical Brand Standard record and lifecycle.
- Ownership and effective dating of reusable asset collections.
- Required assurance checks and evidence retention.
- Resolution when multiple applicable brand scopes conflict.
