# Pack 2 Schema Design Report

## Status

These JSON Schema Draft 2020-12 contracts are draft business schemas generated from the authorised ZIP snapshot only. They are not adopted schemas, database designs, APIs or implementation models.

## Authority used

1. Approved Canon, where represented in the ZIP supporting artefacts.
2. Approved Pack 2 BDR Decisions.
3. Approved Governed Refactoring Register entries in `Pack 2 Governed Refactoring Register.docx`.
4. Supporting review artefacts in the ZIP.

## Design choices

- Ownership, authority, assignment, capability, configuration and permission concepts are separate schema contracts.
- Every schema includes `schemaVersion`, provenance, effective dating where relevant, lifecycle/status where relevant, and audit metadata.
- `additionalProperties: false` is used throughout every object definition authored in this draft.
- AUTHMOD actions use only the approved vocabulary: View, Contribute, Manage, Approve, Publish and Administer.
- Capability enablement records availability only; it does not grant authority or redefine domain meaning.
- Overrides and dependency rules preserve approval, reason, effective period and audit history.
- Emergency access is modelled as exceptional, time-limited and reviewable.

## Deliberately not included

- Database tables, collections, APIs, provider IDs, application roles, production implementation details or storage-specific constructs.
- Final business lifecycle catalogues beyond status values needed to express lifecycle, expiry, revocation and retirement in the approved decisions.
- Named individuals as enduring business owners.

## Open review questions

- Confirm whether the draft lifecycle/status vocabularies should be standardised across Pack 2 or split per domain.
- Confirm whether `other` should remain available for governed scope and information categories, or be replaced by future approved catalogues.
- Confirm whether authority grants to named assignees should remain optional as a delegated execution mechanism while role authority remains primary.
- Confirm whether approval/publication relationships should stay as a separate control record or be embedded by subject schemas in later packs.
