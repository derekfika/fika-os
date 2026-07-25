# Validation Boundary

## Status

Stage 6 supporting specification governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md). FIKA Core may standardise validation-result structure; it does not own domain rules.

## Structural validation

Canonical schemas define record shape, required fields, formats and closed-property boundaries. Structural validation runs at every trust boundary. A structurally valid record may still be invalid under business, authority or workflow rules.

## Domain validation

The owning domain service enforces meaning, invariants, lifecycle transitions, effective dates, relationships and approved policy. Domain rules are not duplicated in applications, adapters or Core.

## Authority validation

AUTHMOD independently evaluates controlled action, organisational role, assignment, scope, effective period, access boundary, delegation and separation of duties. Ownership, capability state and technical access do not substitute for an authority grant.

## Orchestration validation

Orchestration verifies cross-domain preconditions, source versions, idempotency, sequencing and compensation policy. It must call the owning domain for any domain decision.

## Repository validation

Repositories enforce durable uniqueness, expected version and other persistence constraints required by the domain contract. A persistence error must not be presented as a successful domain change.

## Adapter validation

Adapters validate transport, provider and legacy-input constraints and translate failures. They preserve source references and reject or quarantine inputs that cannot safely normalise. They do not repair ambiguous business meaning by guessing.

## Event-contract validation

Producers validate the ADR-005 envelope and event-type contract before publication. Consumers reject unsupported envelope or event-contract versions visibly, tolerate compatible optional additions, deduplicate stable event identities and still revalidate every resulting command at the receiving domain. Structural event validity never proves authority or business eligibility.

## Application validation

Applications provide timely feedback and accessibility but are not the authoritative enforcement boundary. Every command is revalidated after crossing the application boundary.

## Common result

A domain-neutral validation issue may carry a stable code, category, affected path or subject, safe message, severity and correlation reference. Exact shape and error-disclosure policy require a later contract decision.

## Open questions

- Common error taxonomy and localisation.
- Warning versus blocking policy by domain.
- Quarantine and correction workflow for ambiguous legacy input.
- Safe disclosure rules for sensitive validation failures.
