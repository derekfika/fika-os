# FIKA Core Notification Model

## Purpose

Notifications communicate an already-authorised business intent or request attention. They are effects of domain workflows, not sources of truth and not substitutes for domain status.

## Generation versus delivery

### Notification generation

Owned by Notification Service using intent from the source domain. It determines:

- why the notification exists;
- source record ID/version and business event;
- intended audience/recipient references;
- message/template and brand context;
- permitted channels and priority;
- deduplication key;
- scheduling/expiry and preference policy;
- document/reference attachments by stable ID;
- audit and sensitivity classification.

Generation produces a versioned notification intent. It does not claim delivery.

### Notification delivery

Owned by channel adapters. It determines:

- address/device/channel resolution under permission and preference policy;
- provider-specific rendering/mapping;
- dispatch, acknowledgement, failure and retry results;
- provider references and diagnostics;
- bounded retries, suppression and escalation.

Delivery records never become the authoritative booking, event, production or equipment state.

## Channels

### Email

Suitable for external/client and internal messages where an address and approved content exist. Delivery must be duplicate-safe, branded, accessible, privacy-aware and traceable without storing unnecessary message content.

### Dashboard

An in-application notification or task indicator linked to an authorised view. Dashboard notification state is operational; dismiss/read state does not alter source-domain status unless a separate governed action is taken.

### Future mobile

A future delivery channel for time-sensitive, authorised alerts. Device registration, consent, quiet hours, sensitivity, expiry and escalation require discovery.

### Future Teams/Slack

Future collaboration-channel adapters may deliver internal notifications. Workspace/channel identity, membership, message retention, interactive actions and external-provider permissions require separate decisions. These channels must not become canonical workflow stores.

## Notification intent

Candidate intent information:

- stable notification ID and version;
- source domain/record/version and event type;
- recipient or audience references, not uncontrolled address lists;
- template/content version and parameters;
- effective brand/context;
- allowed/requested channels;
- priority, scheduled time and expiry;
- deduplication/idempotency reference;
- sensitivity and retention classification;
- status of intent: pending, suppressed, scheduled, dispatching, completed, partially delivered, failed or cancelled (final vocabulary TODO).

This is conceptual, not a schema.

## Policy

- Source domain decides that a notification is warranted.
- Notification policy decides recipients, channel eligibility, template and timing.
- Permission/preference policy may suppress or reroute delivery.
- Critical operational escalation may have approved overrides; owner TODO.
- Retries must not create duplicate messages.
- Content must be generated from the referenced authoritative version.
- A changed source version requires explicit supersession or a new intent.
- Attachments are referenced through Document/Media capabilities and authorised at delivery time.

## Failure and observability

Record each attempt independently. Classify invalid recipient, permission/preference suppression, transient delivery failure, permanent rejection, expired intent and content/rendering error. Expose safe operational status and a manual recovery action.

Authoritative workflows must define whether notification failure blocks completion, creates `needs review`, or continues with escalation. The Notification Service does not decide this universally.

## Open questions

- TODO: Confirm notification owners, recipient sources and preference policy.
- TODO: Define channel priority, escalation and quiet-hour rules.
- TODO: Approve intent/delivery statuses and retention.
- TODO: Define which business workflows require successful delivery.
- TODO: Define accessible template governance and translation/localisation needs.
