# Architecture Review Checklist

## Purpose

Use this checklist before implementation when a change introduces or alters a domain concept, shared workflow, canonical schema, integration, repository, permission boundary, operational projection, migration, or cross-application capability.

Not every question applies. Record “not applicable” with a reason. Unresolved material questions should block implementation or be explicitly accepted by the decision owner.

## Business and scope

- [ ] Is the problem stated in business terms with a confirmed owner?
- [ ] Are users, outcomes, urgency, and success measures confirmed or marked TODO?
- [ ] Is the capability inside FIKA Platform scope?
- [ ] Is this an existing need, future domain, experiment, or committed implementation?
- [ ] Are current manual steps and operational friction understood?
- [ ] What must not change?

## Domain boundaries

- [ ] Which domain owns the concept and lifecycle?
- [ ] Is this commercial intent, operational workflow, production work, integration metadata, configuration, or reporting?
- [ ] Are similarly named concepts in other domains actually different?
- [ ] Does the design preserve separation between public/client experiences and internal operations?
- [ ] Are domain rules independent from interface and storage layout?

## Authority and data

- [ ] What is the source of truth for each record and configuration value?
- [ ] Which representations are canonical records, operational projections, caches, audit history, or legacy inputs?
- [ ] Is update direction and reconciliation defined?
- [ ] Are stable IDs, versions, timestamps, actors, status ownership, and source references defined?
- [ ] Are money, units, time zones, locations, optionality, and lifecycle semantics unambiguous?
- [ ] Is personal or sensitive data minimised and governed?

## Schemas and compatibility

- [ ] Is a canonical schema required, and is its status clear?
- [ ] Are required/optional fields, validation, fixtures, ownership and source-of-truth documented?
- [ ] Are provider/parser fields kept out of the canonical model unless essential?
- [ ] What compatibility is required for existing producers and consumers?
- [ ] How will versions be introduced, migrated, deprecated, and retired?
- [ ] Have downstream workflows tested the model?

## Workflows and consistency

- [ ] What command or event starts the workflow?
- [ ] Is the workflow safe to retry and protected against duplicate effects?
- [ ] How are stale updates and concurrent mutations handled?
- [ ] What happens on partial success, timeout, cancellation, amendment, or dependency failure?
- [ ] Which effects are authoritative, projected, reversible, or externally irreversible?
- [ ] Is human review explicit where business judgement remains necessary?

## Repository and storage independence

- [ ] Are repository interfaces described in domain terms?
- [ ] Can storage change without redefining the domain contract?
- [ ] Are canonical records, projections, configuration, files, audit and checkpoints separated where appropriate?
- [ ] Are retention, backup, restoration and reconciliation requirements known?
- [ ] Is a storage decision being made from measured needs rather than assumption?

## Integrations and adapters

- [ ] Is provider-specific behaviour contained in an adapter?
- [ ] Are authentication, permissions, limits, retries, idempotency and failure classification defined?
- [ ] Does the adapter preserve stable source references and mapping diagnostics?
- [ ] Can unresolved input enter manual review without invented facts?
- [ ] Are legacy adapters retained until parity, rollback and retention conditions are met?

## Configuration and tenancy

- [ ] Is each variation configuration or a genuine rule difference?
- [ ] Who owns, validates, approves and audits configuration changes?
- [ ] Are safe/public configuration, private configuration and secrets separated?
- [ ] Are site/client boundaries and defaults explicit?
- [ ] Can a missing or invalid configuration fail safely?

## Security and permissions

- [ ] Are roles, permissions, site/client boundaries and least privilege defined?
- [ ] Are permissions enforced at authoritative boundaries?
- [ ] Are secrets kept outside repositories and output?
- [ ] Are sensitive actions attributable and auditable?
- [ ] Are data retention, deletion, evidence and privacy requirements confirmed?
- [ ] Are abuse, malformed input and excessive-volume cases considered?

## User experience

- [ ] Does the design use the user's language and reduce duplicate entry?
- [ ] Are status, ownership, next action and exceptions clear?
- [ ] Are loading, empty, success, warning, error and recovery states defined?
- [ ] Are accessibility, responsive behaviour and permission-denied states included?
- [ ] Does the interface preserve work and avoid exposing implementation detail?

## Performance and reliability

- [ ] Is there a measured baseline or a plan to obtain one?
- [ ] Are volumes, concurrency, payloads, calls, latency and operational limits known?
- [ ] Does the design avoid repeated reconstruction and unnecessary transfer?
- [ ] Are health, structured logs, metrics, alerts and support ownership defined?
- [ ] Are rollback, resume, replay, recovery and business-continuity paths credible?

## Delivery and migration

- [ ] Can the change be delivered in small, reversible increments?
- [ ] Is parallel operation/reconciliation required?
- [ ] Are fixtures and regression tests available for current variants?
- [ ] Is deployment separate from activation where useful?
- [ ] Are release, smoke test, monitoring, rollback and communication plans documented?
- [ ] Does retirement require usage, retention and owner approval?

## Decision record

- [ ] Does this require a new or superseding ADR?
- [ ] Are alternatives and consequences documented?
- [ ] Are TODOs assigned to a decision owner or future review point where known?
- [ ] Is the implementation authorised, or is the output still discovery/design only?

## Review outcome

Record one result:

- **Approved:** implementation may proceed within the reviewed boundary.
- **Approved with conditions:** named conditions must be completed before release.
- **More evidence required:** discovery, measurement, or business decisions are missing.
- **Rejected:** record why and any acceptable alternative.

TODO: Confirm architecture decision forum, required reviewers, and approval authority.
