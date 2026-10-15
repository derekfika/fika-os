# Grab & Go standing orders

Scope: Delivered-In Grab & Go only. Occurrences are ordinary canonical G&G orders; CPU semantics are unchanged.

## Rules
- Service days are Monday and Wednesday only. Recurrence modes: Monday, Wednesday, Monday & Wednesday. Anything else is rejected (422).
- Exactly one future occurrence at a time. A daily run creates the next configured date strictly after the latest occurrence, only when the latest occurrence is before today (Europe/London) and the new date is still before its order cut-off (12:00 the day before). Past or cut-off-passed dates are skipped, never back-filled.
- Idempotency: order id is `grab-and-go:{oplocId}:{date}`; occurrence + template pointer (`lastOccurrenceDate`) + CPU handoff event are written in one SQLite `BEGIN IMMEDIATE` / Firestore transaction, guarded by `expectedLast`.
- A site/date that already has an order (manual or cancelled) is never overwritten; the pointer advances and the occurrence is skipped.
- Template lines not offered by the catalogue for that date/rotation week are omitted; if none remain nothing is created and the run reports `no-valid-lines`.

## Storage
- Hosted: Firestore `fikaDeliveredInGrabAndGoStandingOrdersV1` (doc id = sha256 of `standingOrderId`). Queries are single-field equality (`status`, `oplocId`); no composite index is needed.
- Local: `standingOrders` inside the existing SQLite state document.
- `standingOrderId` = `standing:{sourceOrderId}`.

## Scheduler (not yet created)
Cloud Scheduler job, once each morning:

- schedule `0 6 * * *`, timeZone `Europe/London`, POST `https://<delivered-in-host>/api/internal/grab-and-go-standing-orders`
- headers: `Content-Type: application/json`, `x-fika-internal-token: <FIKA_INTERNAL_API_TOKEN>` ; body `{}`
- retryConfig as the existing `fika-delivered-in-grab-and-go-outbox-recovery` job. Safe to retry or run twice.

The response lists per-template outcomes (`created`, `skipped-existing-order`, `no-valid-lines`, `not-needed`, `conflict`, `error`).
