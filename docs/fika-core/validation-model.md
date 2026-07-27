# Validation Boundary

## Status

Stage 6 supporting specification governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md), [ADR-006](../decisions/ADR-006-repository-and-consistency-contract.md), [ADR-007](../decisions/ADR-007-projection-and-dashboard-boundary.md), [ADR-008](../decisions/ADR-008-identity-and-authmod-enforcement-boundary.md) and [ADR-009](../decisions/ADR-009-booking-to-production-orchestration.md). FIKA Core may standardise validation-result structure; it does not own domain rules.

## Projection validation

Projection builders validate input identity, origin, contract version and access before updating derived state. They handle duplicates safely, reject or quarantine incompatible input, compare attributable source versions rather than arrival order alone, and expose gaps, stale sources, partiality and rebuild state. Projection validity does not prove canonical correctness or command eligibility.

## Structural validation

Canonical schemas define record shape, required fields, formats and closed-property boundaries. Structural validation runs at every trust boundary. A structurally valid record may still be invalid under business, authority or workflow rules.

## Domain validation

The owning domain service enforces meaning, invariants, lifecycle transitions, effective dates, relationships and approved policy. Domain rules are not duplicated in applications, adapters or Core.

## Authority validation

AUTHMOD independently evaluates a recognised actor, controlled action, organisational role, Assignment, Authority Grant, scope, effective period, access boundary, delegation and separation of duties. Authentication, account mapping, ownership, capability state, Configuration, provider claims and technical access do not substitute for an Authority Grant. Missing or unavailable required authority fails safely.

## Orchestration validation

Orchestration verifies cross-domain preconditions, source versions, idempotency, sequencing and compensation policy. It must call the owning domain for any domain decision.

## Repository validation

Repositories enforce durable uniqueness, the applicable comparison token and other persistence constraints required by the domain contract. A stale conflict requires current-state revalidation; a failed or uncertain persistence outcome must not be presented as a successful domain change.

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
