# Authority and Permission Enforcement Model

## Status

Stage 6 supporting specification governed by ROLE-001–007, CAP-004, [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md) and [ADR-008](../decisions/ADR-008-identity-and-authmod-enforcement-boundary.md). It defines conceptual enforcement boundaries, not authentication or access-control technology.

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

After accepted authentication evidence maps a principal to a recognised FIKA actor, an authoritative action check considers at least:

- authenticated actor reference;
- effective assignment to the applicable organisational role where required;
- explicit authority grant;
- controlled action;
- governed business scope;
- effective period and status;
- access boundary, information sensitivity and least privilege;
- separation-of-duties or approval/publication constraints;
- applicable delegation or emergency-access evidence.

Applications may hide unavailable actions, but every protected command, authoritative query, projection/export read and administrative operation enforces at its authoritative boundary. Repository access, provider sharing and client-side checks cannot authorise a business action.

## Approval and publication

Contribute, Manage, Approve and Publish are separate actions. Approval does not publish, and publication requires the necessary approval. The same person may perform multiple actions only where each is explicitly granted and the owning domain permits it.

## Delegation

Delegation is scoped, auditable, revocable and time-limited. Temporary delegation has a mandatory end date and never transfers ownership or changes the underlying organisational role.

## Emergency access

Emergency access is a separate temporary grant for an immediate qualifying need. It is minimum-scope, fixed-duration, fully audited and independently reviewed. Technical seniority or administrator access does not create it.

## Authentication boundary

Authentication establishes an accepted principal under stated conditions. A governed account mapping resolves a stable FIKA actor; AUTHMOD then establishes what that actor may attempt in a business scope. Authentication success, email, provider group, account mapping, session validity and Assignment do not independently grant authority.

Person, Worker, actor and account lifecycle ownership remains a business-policy question. ADR-008 adopts no identity-provider mapping, automatic linking or workforce lifecycle rule.

## System actors

Automated processes require explicit actor identity, purpose, scope and authority appropriate to their actions. A human-initiated background task preserves both initiating and executing actors; the service does not impersonate the human or inherit developer/application authority.

## No invented role catalogue

This specification intentionally defines no candidate Platform Administrator, Site Administrator, operator or viewer roles. Operations Leadership owns the organisation-wide Role Catalogue; domains own responsibilities and authority requirements. Architecture must consume that catalogue rather than invent it.

## Audit

Grant, change, evaluation where required, privileged use, expiry and revocation must be reconstructable. Domain audit records should reference the actor and effective authority context without copying the whole authority model into each aggregate.

## Open questions

- Person, Worker, actor and account ownership and lifecycle.
- Approved provider/account linking, recovery and migration rules.
- Domain-specific delegation, support impersonation and service-actor authority.
- Numerical decision-cache validity and revocation-propagation objectives.
- Domain information classifications and restricted-field projections.
