# FIKA Core Permissions Model

## Purpose

The permissions model defines conceptually who may perform which action on which resource and scope. It does not define authentication, identity-provider configuration, user-interface visibility or implementation.

Permissions are enforced at authoritative service/workflow boundaries. Hiding a control is not authorisation.

## Core concepts

- **Actor:** a stable person or system identity making a request.
- **Role:** a named collection of responsibilities, not a job title alone.
- **Permission:** an allowed action on a resource type.
- **Scope:** where the permission applies: global, domain, client, site, application, record or owned assignment.
- **Condition:** additional rule such as record status, assignment, time, sensitivity or approval requirement.
- **Grant:** assignment of a role/permission to an actor or group within scope.
- **Restriction:** explicit denial or limitation that takes precedence according to policy.
- **Decision:** allow or deny with a safe reason and policy version.

## Candidate conceptual roles

Roles are provisional and may be combined or specialised after user/owner discovery.

### Platform Administrator

Manages approved platform-level configuration, role assignments and operational administration. Does not automatically receive unrestricted access to sensitive business records.

### Domain Administrator

Administers one domain's policies/configuration and operational access. Scope may be Hospitality, Events, Production, Logistics, Media, Equipment or Workforce.

### Site Administrator

Manages authorised site configuration, memberships and operations within one or more sites. Cannot change global policy or other sites.

### Booking Operator

Reviews bookings and may submit permitted governed amendments/status actions. Cannot bypass commercial policy, concurrency or audit.

### Commercial Approver

Approves quotes, pricing exceptions, discounts or commercial transitions within defined limits. Exact authority TODO.

### Production Operator

Views and progresses production work, records preparation notes/evidence and raises exceptions. Cannot directly change the authoritative booking.

### Event Operator

Creates, qualifies and manages events within assigned scope. Detailed transitions require Events discovery.

### Logistics Operator

Plans or progresses authorised logistics work. Detailed role split requires Logistics discovery.

### Equipment Operator

Manages equipment availability, allocations, faults and returns within scope.

### Media Contributor

Submits/indexes assets and metadata but cannot necessarily approve or publish them.

### Media Approver

Approves visibility, rights and publication of media within assigned brand/domain scope.

### Reporting Viewer

Reads authorised operational or executive reporting without mutation rights or unrestricted source-record access.

### Client User

Accesses explicitly shared client-facing records/actions within a client/site scope. Never receives implicit access to internal operational data.

### Auditor

Reads authorised immutable history and configuration/permission changes. Does not mutate business records.

### System Actor

Performs a narrowly defined automated workflow or integration action. Uses least privilege and a stable attributable identity.

## Permission decisions

A decision evaluates:

```text
actor + action + resource + scope + current context + policy version
```

The result is allow or deny. “Unknown” should fail closed for authoritative/sensitive actions. Denial messages are actionable without revealing protected policy or record existence.

## Separation of duties

High-risk actions may require different roles or explicit approval, including:

- granting platform/domain administration;
- publishing global configuration/brand/permission changes;
- approving exceptional pricing or refunds;
- accessing/exporting sensitive personal data;
- deleting/redacting records under retention policy;
- overriding validation;
- executing irreversible migration or release actions.

Exact approval thresholds and dual-control rules are TODO.

## Site, client and domain isolation

- Access is scoped explicitly; membership in one site/client does not imply another.
- Cross-site company roles require deliberate grants.
- Public/client users receive minimum records/fields/actions required for their experience.
- Domain permissions do not automatically cross into Workforce, Media, Equipment or reporting.
- Operational projections enforce the same underlying scope as authoritative records.

## Privacy and audit

Permission evaluation should consider data sensitivity and purpose, not role name alone. Access to personal contact, dietary/allergy, workforce, evidence and audit information requires minimisation and retention policy.

Important allows/denials, role changes, overrides and administrative actions are auditable using safe metadata. Audit visibility is itself permission-controlled.

## Relationship to user preferences and authentication

Authentication establishes actor identity; it does not decide authority. User preferences affect presentation/notifications only and cannot grant permission. External provider permissions are adapter configuration and do not replace Core authorisation.

## Open questions

- TODO: Confirm actor/user ownership and lifecycle.
- TODO: Map real business roles, sites, clients and domain responsibilities.
- TODO: Approve permission/action vocabulary and scope hierarchy.
- TODO: Define separation-of-duty, approval and emergency-access rules.
- TODO: Define personal-data classification, retention and audit-access policy.
- TODO: Define system-actor creation, rotation, review and deactivation governance.
