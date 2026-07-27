# Notification Boundary

## Status

Stage 6 supporting specification governed by [ADR-001](../decisions/ADR-001-stage-6-platform-boundaries.md), [ADR-005](../decisions/ADR-005-domain-event-and-integration-contract.md) and [ADR-011](../decisions/ADR-011-notification-generation-and-delivery.md). Notifications remain a logical shared capability rather than an adopted business domain; use-case policy remains with its governed owner.

## Generation and delivery

Notification generation evaluates whether a governed business fact or authorised request creates notification intent under an explicit purpose and policy. Recipient, content, timing, acknowledgement and escalation rules belong to their declared business or governance owners; architecture does not infer them from current messages.

Notification delivery transports an approved intent through a channel. It belongs behind a provider port and adapter.

These responsibilities must remain separate. A mail, chat, mobile or dashboard provider must not decide business eligibility or authority.

A domain or integration event records a completed fact; it is not itself a notification. Event delivery to a technical consumer does not mean a Legend or external recipient was notified, and notification-delivery success does not change the underlying business outcome.

## Notification intent

A future cross-domain intent contract may include:

- source domain fact and canonical record/version reference;
- purpose and approved template/content reference;
- intended recipient or governed recipient rule;
- sensitivity and delivery constraints;
- correlation and idempotency references;
- required audit outcome.

Occurrence identity, recipient identity, destination, rendered-message identity, attempt identity and provider message identity remain distinct. Repeated triggers resolve to one logical occurrence, while attempts remain individually attributable.

This list is architectural guidance, not an adopted schema.

## Channels

Email and dashboard delivery are evidenced current needs. Mobile and team-messaging channels remain future possibilities. Channel availability must not change the underlying business fact.

## Failure and audit

Delivery attempts distinguish prepared, dispatch requested, provider accepted, delivery observed, failed, delayed, uncertain, partial, suppressed and expired outcomes. Retry is occurrence-aware and idempotent; unknown outcomes are reconciled before unsafe resend. Provider delivery does not prove human receipt or acknowledgement. Provider logs support operations but do not replace domain audit or approval evidence.

## Explicit exclusions

- Provider-specific fields in canonical domain records.
- Recipient or escalation policy invented by architecture.
- Treating a Calendar entry, email or dashboard alert as the authoritative business record.
- Treating provider acceptance as delivery or acknowledgement.
- Letting replay or projection rebuild resend external messages by default.
- Treating a reply or action link as a domain mutation without an authorised command.

## Open questions

- Which owner governs each notification class, recipient rule and content definition.
- Trigger, purpose, consent/lawful basis and sensitive-data rules.
- Channel, fallback, timing, acknowledgement and escalation policy.
- Retry, retention, deletion, tracking and delivery-evidence requirements.
