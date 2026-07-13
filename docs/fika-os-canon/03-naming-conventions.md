# FIKA OS Naming Conventions

## Purpose

These conventions keep business language stable across decisions, schemas, architecture and applications. Abbreviations follow accepted business language rather than software convenience.

## Approved abbreviations

| Abbreviation | Business term | Status |
|---|---|---|
| OPLOC | Operational Location | Approved |
| OPCAP | Operational Capability | Approved |

Use the full business term on first reference, followed by its abbreviation in parentheses. Use the abbreviation alone only when the audience and context are clear.

## Reserved candidate abbreviations

| Abbreviation | Candidate term | Governance status |
|---|---|---|
| CLORG | Client Organisation | Discovery Candidate |
| COMAG | Commercial Agreement | Discovery Candidate |
| OPREL | Operational Relationship | Discovery Candidate |

Reservation prevents reuse for another meaning. It does not approve the candidate or allow it into a schema.

## Business naming

- Use the exact canonical business term where one exists.
- Use singular names for a concept and plural names only for a collection of that concept.
- Name a relationship for the business meaning it carries rather than concatenating two object names.
- Do not use a provider, application, screen, spreadsheet or storage term as the name of a FIKA business concept.
- Do not create synonyms for canonical language merely to suit one application.
- User-facing labels may be friendlier where appropriate, but they must map unambiguously to the canonical term.

## Schema naming

- A schema represents one canonical business concept or governed relationship.
- Use the full singular canonical business name as the schema title unless an approved abbreviation is itself the accepted name.
- Keep version identity separate from the enduring business name.
- Do not encode a provider, storage location, tenant, Client or application variant in a canonical schema name.
- Candidate terms must not become schema names until an accepted BDR makes the concept canonical.
- A reference to another domain uses that domain's canonical identity rather than copying its internal fields.

## Pluralisation

- **Operational Location** names one concept; **Operational Locations** names a collection.
- **Operational Capability** names one capability; **Operational Capabilities** names a collection.
- Keep abbreviations unchanged in plural prose where adding an “s” would reduce clarity: “three OPLOC records” and “enabled OPCAP assignments”.
- Avoid collective labels that conceal whether the subject is an identity, relationship, assignment or collection.

## Reserved naming rules

- The prefixes **OP**, **COM** and **CL** are not globally available shortcuts; only the specifically governed abbreviations listed here are reserved.
- **FIKA** and **Fika** identify FIKA-wide business meaning or branding and must not be used to make a local implementation appear canonical.
- A reserved candidate abbreviation must remain labelled as a candidate in discovery material.
- New abbreviations require an accepted business-language decision and an update to the [Domain Dictionary](02-domain-dictionary.md).

## Examples

- **Operational Location (OPLOC):** canonical place or operating-context identity.
- **Operational Capability (OPCAP):** reusable function enabled for an OPLOC.
- **Commercial Agreement (COMAG):** reserved discovery candidate, not a canonical schema.
- **Operational Relationship (OPREL):** reserved discovery candidate, not a canonical schema.
- **Client Organisation (CLORG):** reserved discovery candidate and must not duplicate canonical Client.

## Related Canon

- [Cohesion Principles](01-cohesion-principles.md)
- [Domain Dictionary](02-domain-dictionary.md)
- [Authority Model](04-authority-model.md)
- [Discovery Register](05-discovery-register.md)

