# Provider Mapping Principles

## Purpose

This document governs how external providers, legacy systems and ingestion channels exchange data with FIKA OS canonical schemas. It does not define provider implementations or create canonical schemas.

## Governing position

Providers map into canonical schemas. Providers never own or define canonical business meaning. Canonical schemas remain stable when a provider, product, account or integration changes.

A mapping translates between two models; it does not make the provider model canonical.

## Principles

1. **Canonical meaning comes first.** Define the canonical concept from accepted BDRs before designing a provider mapping.
2. **Mappings are separate artefacts.** Do not place provider field names, workflow states or transport details in canonical objects merely to simplify an integration.
3. **Canonical identity is independent.** Provider IDs are references only and must not replace stable FIKA identity.
4. **Provenance is preserved.** Record the provider or channel, source reference, mapping version and relevant ingestion context outside canonical business meaning.
5. **Transformation is explicit.** Document field mapping, normalisation, defaults, rejected values, lossy conversion and unmapped data.
6. **No silent inference.** Missing provider information must not be guessed. Reject, quarantine or route it for governed resolution as appropriate to later architecture.
7. **Round trips are not assumed.** A mapping must state whether it is inbound, outbound or bidirectional and identify information that cannot round-trip safely.
8. **Provider state is not domain state.** Provider statuses may be mapped only where an accepted BDR establishes semantic equivalence; otherwise retain them as integration metadata.
9. **Validation occurs at both boundaries.** Validate provider input against the provider contract, then validate the mapped result against the canonical contract.
10. **Change is versioned.** Provider mappings are versioned independently so provider changes do not silently alter canonical interpretation.
11. **History is retained.** Preserve source references and mapping history needed to explain how a canonical record was derived.
12. **Security and minimisation apply.** Map only required information; never copy secrets or unnecessary personal data into canonical records or fixtures.

## Mapping record requirements

Each mapping specification should identify:

- canonical schema identity and version;
- provider or legacy source and relevant source-model version;
- direction of travel;
- field-by-field transformations;
- canonical and provider identifiers;
- provenance retained;
- required defaults or enrichment and their authority;
- validation and rejection behaviour;
- known information loss or ambiguity;
- lifecycle/status translation where approved;
- example inputs and outputs using fictional data;
- BDR and schema dependencies;
- mapping owner, review status and version.

## Named provider contexts

### Square

Square data must map through a versioned provider mapping. Square identifiers remain references. Product, transaction or status structures must not define FIKA canonical concepts.

### Goodtill

Goodtill is treated as a provider or legacy source. Migration mappings should preserve provenance and explicitly document any semantic gap rather than reshaping canonical schemas around historical fields.

### BrightHR

BrightHR data must map to the relevant approved workforce concepts only after those canonical boundaries exist. Provider employee identifiers, statuses and fields remain provider references or integration metadata unless supported by accepted BDRs.

### Google Workspace

Google Workspace services are external providers and operational tools. Document, message, calendar and file identifiers remain references. Sheets, email, calendars and Drive structures must not become canonical domain models.

### Email ingestion

Email ingestion is a legacy or transitional adapter. It may produce the same canonical contract as a direct submission while preserving message provenance, parser version, ambiguity and rejection information outside the canonical aggregate. Email wording and layout do not define canonical properties.

### Legacy systems

Legacy systems remain evidence and transition sources. Their identifiers, columns and state labels must be mapped explicitly. Where a source cannot supply required canonical meaning, the mapping must surface the gap rather than invent a value.

### Future providers

Future providers follow the same process: assess the canonical contract first, create a separate mapping, validate both boundaries and preserve provenance. A new provider does not, by itself, justify changing a canonical schema.

## Provider-change process

1. Identify the affected provider mapping and canonical schema version.
2. Classify the provider change as compatible, mapping-breaking or evidence of a possible business change.
3. Update and review the mapping for provider-only change.
4. If business meaning may have changed, return to the relevant BDR process before proposing a schema change.
5. Revalidate fictional mapping fixtures and retain the previous mapping version for traceability.

## Boundaries

Provider mapping does not own:

- canonical business definitions;
- domain workflow policy;
- permission policy;
- provider selection;
- storage design;
- implementation or deployment architecture.

Those matters remain with their governing BDR, schema, architecture or delivery stage.

## Related documents

- [Schema Generation and Approval Process](schema-generation-and-approval-process.md)
- [Schema Review Checklist](schema-review-checklist.md)
- [Documentation Governance](../documentation-governance.md)
- [Stage 5 — Schema Design](../stages/stage-5-schema-design.md)

