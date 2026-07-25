# Authority and Permission Enforcement Model

## Status

Stage 6 supporting specification governed by ROLE-001–007, CAP-004 and [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md). It defines conceptual enforcement boundaries, not authentication or access-control technology.

## Governing distinctions

- Business ownership identifies the accountable role for meaning or work.
- Responsibility describes work or accountability associated with a role or domain.
- Assignment links a named person to a role, responsibility or scope for an effective period.
- Authority is an explicit AUTHMOD grant to an organisational role for an action, scope and effective period.
- Permission action is one of the controlled actions View, Contribute, Manage, Approve, Publish and Administer.
- Capability enablement says a business ability is available; it grants no authority.
- Technical administration implements controls; it grants no business ownership or authority.

No item above may be inferred from another.

## AUTHMOD evaluation

An authoritative action check considers at least:

- authenticated actor reference;
- effective assignment to the applicable organisational role where required;
- explicit authority grant;
- controlled action;
- governed business scope;
- effective period and status;
- access boundary, information sensitivity and least privilege;
- separation-of-duties or approval/publication constraints;
- applicable delegation or emergency-access evidence.

Applications may hide unavailable actions, but the domain-service boundary must enforce the decision. Repository access alone cannot authorise a business action.

## Approval and publication

Contribute, Manage, Approve and Publish are separate actions. Approval does not publish, and publication requires the necessary approval. The same person may perform multiple actions only where each is explicitly granted and the owning domain permits it.

## Delegation

Delegation is scoped, auditable, revocable and time-limited. Temporary delegation has a mandatory end date and never transfers ownership or changes the underlying organisational role.

## Emergency access

Emergency access is a separate temporary grant for an immediate qualifying need. It is minimum-scope, fixed-duration, fully audited and independently reviewed. Technical seniority or administrator access does not create it.

## Authentication boundary

Authentication establishes who or what is acting. AUTHMOD establishes what that actor may do in a business scope. The mapping from provider identity to Person, Assignment and authority context requires a follow-up ADR.

## System actors

Automated processes require explicit identity, purpose, scope and authority appropriate to their actions. They do not inherit the authority of a developer, administrator or initiating application.

## No invented role catalogue

This specification intentionally defines no candidate Platform Administrator, Site Administrator, operator or viewer roles. Operations Leadership owns the organisation-wide Role Catalogue; domains own responsibilities and authority requirements. Architecture must consume that catalogue rather than invent it.

## Audit

Grant, change, evaluation where required, privileged use, expiry and revocation must be reconstructable. Domain audit records should reference the actor and effective authority context without copying the whole authority model into each aggregate.

## Open questions

- Authentication identity mapping.
- Service-to-service and delegated system authority.
- Decision-cache validity and revocation propagation.
- Domain information classifications and restricted-field projections.
