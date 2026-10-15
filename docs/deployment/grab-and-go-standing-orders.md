# Grab & Go standing orders

Scope: Delivered-In Grab & Go only. Occurrences are ordinary canonical G&G orders; CPU semantics are unchanged.

## Rules
- Service days are Monday and Wednesday only. Recurrence modes: Monday, Wednesday, Monday & Wednesday. Anything else is rejected (422).
- Exactly one future occurrence at a time. A daily run creates the next configured date strictly after the latest occurrence, only when the latest occurrence is before today (Europe/London) and the new date is still before its order cut-off (12:00 the day before). Past or cut-off-passed dates are skipped, never back-filled.
- Idempotency: order id is `grab-and-go:{oplocId}:{date}`; occurrence + template pointer (`lastOccurrenceDate`) + CPU handoff event are written in one SQLite `BEGIN IMMEDIATE` / Firestore transaction, guarded by `expectedLast`.
- A site/date that already has an order (manual or cancelled) is never overwritten; the pointer advances and the occurrence is skipped.
- See fail-closed section below: lines are never dropped.

## Storage
- Hosted: Firestore `fikaDeliveredInGrabAndGoStandingOrdersV1` (doc id = sha256 of `standingOrderId`). Queries are single-field equality (`status`, `oplocId`); no composite index is needed.
- Local: `standingOrders` inside the existing SQLite state document.
- `standingOrderId` = `standing:{sourceOrderId}`.

## Scheduler (not yet created)
Cloud Scheduler job, once each morning:

- schedule `0 6 * * *`, timeZone `Europe/London`, POST `https://<delivered-in-host>/api/internal/grab-and-go-standing-orders`
- headers: `Content-Type: application/json`, `x-fika-internal-token: <FIKA_INTERNAL_API_TOKEN>` ; body `{}`
- retryConfig as the existing `fika-delivered-in-grab-and-go-outbox-recovery` job. Safe to retry or run twice.

The response lists per-template outcomes (`created`, `skipped-existing-order`, `needs-attention`, `not-needed`, `conflict`, `error`).

## Fail-closed (supersedes "dropped lines")
If any template line is unavailable for the occurrence (not offered that weekday/rotation week, unknown product, invalid quantity) **no order is created**, `lastOccurrenceDate` is not advanced, and the run reports `needs-attention` with `unavailableProducts`. Lines are never dropped.

- `attention[]` on the template keeps one record per `occurrenceDate`: `open` → `missed` (cut-off passed, audit retained) or `resolved` (created after a fix / superseded). Repeat runs write nothing (no version bump, no duplicates).
- Saving an edit or "update from order" on a template with an open record retries that template immediately, so a same-morning fix is not lost to the next day's run.
- A failed date is never created after its cut-off; the next valid Monday/Wednesday is evaluated instead.
