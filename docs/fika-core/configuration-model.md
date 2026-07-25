# Configuration Boundary

## Status

Stage 6 supporting specification governed by CFG-001–003, CAP-003 and [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md). Configuration is a governed domain responsibility, not content owned by FIKA Core.

## Purpose

Configuration expresses an authorised variation in how an approved business capability or application behaves within an explicit scope. It must not redefine canonical meaning, create authority or bypass protected rules.

## Governed scopes

Evidence confirms organisation-wide, Client, Brand, Operational Capability, Operational Location, Application and other domain-scoped configuration may exist. A scope is used only where its owning domain has defined the relationship.

No universal precedence sequence is assumed. In particular, “Global → Brand → Site → Application → User” is not a canonical inheritance chain.

## Ownership, authority and administration

- An accountable organisational role owns configuration for its business scope.
- Approval authority is granted separately through AUTHMOD.
- An authorised role may administer approved configuration without acquiring ownership.
- Platform Governance implements representation and assesses cross-domain impact; it does not become business authority.
- Temporary delegation has an explicit scope, fixed end date and audit history and never transfers ownership.

## Inheritance and variation

- Values inherit only through explicitly governed scope relationships.
- A more specific applicable value overrides a broader applicable value only where that relationship and precedence are governed.
- An absent value inherits the nearest valid effective value.
- A variation records inherited value, resulting value, scope, reason, owner, approval, effective period, validation and audit.
- Expiry reveals the next valid inherited value; it does not copy or rewrite history.
- User or application settings cannot override protected business rules without explicit authority.

## Capability relationship

Capability enablement and configuration are separate. Enablement states whether an approved ability is available in a scope. Configuration controls authorised values within that ability. Neither creates permission, assignment or business meaning.

## Secrets

Secrets and credentials are operational security material. They do not participate in business configuration inheritance and never enter canonical records. Their implementation and custody remain undecided.

## Application preferences

A personal or application preference is configuration only if the owning business scope permits it. Presentation preferences must not be promoted into canonical business meaning.

## Enforcement

The Configuration domain resolves effective values and validates governed relationships. AUTHMOD evaluates authority. Consuming domains enforce protected business rules. Adapters prevent secrets and provider details from leaking into canonical values.

## Open questions

- Which scopes and precedence rules apply to each configuration family.
- Configuration publication and rollback policy.
- Review cadence and materiality thresholds.
- Secret-management implementation.
