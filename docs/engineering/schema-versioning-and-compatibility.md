# Schema Versioning and Compatibility Convention

## Status

**Adopted engineering convention for implementation dependencies.** This convention changes no existing schema identity, semantics, status or version. Business meaning and schema adoption remain governed by BDR and Stage 5 authority.

## Purpose

Implementations need a consistent way to declare which governed contract they consume and what compatibility they have proved. This convention supplies that engineering boundary without redesigning historical Packs.

## Identity and version

- A schema's `$id` is its authoritative schema identity.
- Existing `$id` values remain unchanged.
- The exact repository path and Git commit identify the adopted schema artefact used by an implementation.
- A schema-level `schemaVersion`, where present, is the declared contract version. Existing version values remain unchanged.
- A consumer must record schema identity, declared version and source Git commit; a filename or Pack number alone is insufficient.
- Schema version, snapshot-format version and mapping version are independent identifiers.

## Change classification

Use semantic-version intent when a governed schema is revised:

- **Patch:** explanation or annotation changes that do not alter which instances validate or their business meaning.
- **Minor:** backward-compatible additions that existing conforming consumers can safely ignore under the schema's extensibility policy.
- **Major:** any change that can invalidate an accepted instance, changes required meaning, removes or renames a field/value, narrows accepted data, or changes ownership or lifecycle semantics.

A change described as “clarification” is breaking if it changes validation or business meaning. `additionalProperties: false` means adding an allowed property changes the accepted-instance set and therefore requires an explicit compatibility review; it is not automatically safe for every consumer.

## Compatibility claims

- Compatibility is an evidenced consumer claim, not inferred from version numbers alone.
- A consumer declares the exact schema identities and versions it accepts.
- Backward compatibility means the newer producer output is accepted and interpreted correctly by the declared older consumer contract.
- Forward compatibility means the older producer output is accepted and interpreted correctly by the declared newer consumer contract.
- Unknown, untested or semantically ambiguous compatibility is recorded as unsupported.
- Adapters must not silently coerce an unsupported version.

## Deprecation

- Deprecation requires governed authority at the schema layer and an identified replacement or reason.
- A deprecated schema remains available for its declared support period and is not removed merely because a newer version exists.
- Removal requires impact evidence, consumer migration evidence and the applicable release/retirement authority.
- No deprecation period is invented by this convention; each governed change records its own period and owner.

## Fixtures and generated artefacts

- Every fixture declares or is registered against one exact schema identity/version and source commit.
- Valid and expected-invalid fixtures remain version-associated evidence.
- A fixture revision that changes the represented case receives an attributable version or new fixture identity; evidence is not silently overwritten.
- Generated schemas, types, documentation or validators are derived artefacts. They must be reproducible, identify their generator/version and never replace the adopted source schema.

## Snapshot and mapping independence

- An intake snapshot has its own `snapshotFormat` and `snapshotVersion`.
- A mapping has its own `mappingId` and `mappingVersion`.
- Changing a snapshot or mapping does not change a canonical schema version.
- Changing a canonical schema does not silently change a snapshot or mapping.
- Compatibility between all three is declared and tested explicitly.

## Repository paths

- Existing adopted schemas remain at their current `schemas/pack-N/` paths.
- Implementations reference them by `$id`, declared version and source commit.
- A future path convention for new major versions requires a governed Stage 5 decision; implementations must not relocate current schemas.
- Consumer compatibility manifests live with the consuming implementation, not inside an adopted schema file.

## Change authority

- BDR authority controls business meaning.
- Stage 5 schema governance approves schema semantics, version changes, adoption and deprecation.
- Engineering owners implement generators, validators and consumer compatibility declarations.
- Application or adapter owners may version mappings but cannot use mapping versions to redefine governed meaning.
- ADRs may govern architecture consequences but do not approve business/schema changes.

## Increment 1 application

Shadow CPU Production intake records:

- Pack 6 Production Order and Production Line `$id` values;
- their current declared `schemaVersion` values;
- the FIKA OS specification commit containing those artefacts;
- snapshot format/version; and
- mapping ID/version.

Increment 1 may report that a shadow interpretation is incomplete or incompatible. It must not modify Pack 6, invent a compatible default or call a non-conforming shadow representation canonical.

## Validation

An implementation dependency is ready only when tests prove:

- the declared schema artefact resolves;
- supported fixtures behave as declared;
- unsupported versions fail closed;
- mapping/snapshot/schema versions appear in evidence; and
- no compatibility claim exceeds the tested combinations.

## References

- [Documentation governance](../documentation-governance.md)
- [Stage 5 Schema Design](../stages/stage-5-schema-design.md)
- [Testing strategy](testing-strategy.md)
- [Repository standards](repository-standards.md)
