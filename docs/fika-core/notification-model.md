# Notification Boundary

## Status

Stage 6 supporting specification governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md). Notifications are not yet an adopted business domain.

## Generation and delivery

Notification generation decides that a governed business fact requires communication, who should receive it, its business purpose and any timing or escalation policy. That decision belongs to the applicable domain or an approved orchestration policy.

Notification delivery transports an approved intent through a channel. It belongs behind a provider port and adapter.

These responsibilities must remain separate. A mail, chat, mobile or dashboard provider must not decide business eligibility or authority.

## Notification intent

A future cross-domain intent contract may include:

- source domain fact and canonical record/version reference;
- purpose and approved template/content reference;
- intended recipient or governed recipient rule;
- sensitivity and delivery constraints;
- correlation and idempotency references;
- required audit outcome.

This list is architectural guidance, not an adopted schema.

## Channels

Email and dashboard delivery are evidenced current needs. Mobile and team-messaging channels remain future possibilities. Channel availability must not change the underlying business fact.

## Failure and audit

Delivery attempts must distinguish accepted, delivered where knowable, retriable failure and permanent failure. Retry must be idempotent. Provider logs support operations but do not replace domain audit or approval evidence.

## Explicit exclusions

- Provider-specific fields in canonical domain records.
- Recipient or escalation policy invented by architecture.
- Treating a Calendar entry, email or dashboard alert as the authoritative business record.

## Open questions

- Which domain owns each notification policy.
- Recipient resolution and sensitive-data rules.
- Retry, escalation, retention and delivery-evidence requirements.
- Whether Notification later becomes a governed domain or remains orchestration/provider capability.
