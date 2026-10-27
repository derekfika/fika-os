# Driver notifications: capture coverage

Status of PR 1 (durable capture, persistent vehicle-scoped inbox, Notifications tab). Web Push is PR 2.

**Reliable coverage is NOT complete.** Only the operations marked Complete record a committed change event today. Every other
trigger is implemented in the pure rules (`lib/driver-notifications.ts`) and the processor, but its authoritative write path does
not yet stage an event, so that change will not reach the inbox. Do not describe the feature as fully covering the notification
specification until the Outstanding rows are closed.

## Architecture (implemented)

1. A planner write that changes a driver-visible run stages one immutable `DriverChangeEvent` **inside the same Firestore
   transaction** (`stageDriverRunChange`, `lib/driver-notification-store.ts`). It captures the exact before and after driver-visible
   snapshots of each affected run, so later edits cannot hide an intermediate change.
2. Event identity is the action plus every entity version the mutation advanced (`driverChangeEventId`). Staging reads first and
   creates only if absent: a retry cannot overwrite a processed event or reset it to pending.
3. After the save, `processDriverNotificationsSafely` turns pending events into inbox notices from the event's own snapshots.
   A processing failure never fails the planner save; the event stays pending, is retried (bounded to 8 attempts, then parked as
   `failed`), and the app also triggers a bounded `process-pending` recovery when it opens.
4. Notices are keyed by event + committed version + subject, so replays and duplicate delivery create nothing new while later
   independent changes stay distinct (11:30 to 12:00 to 11:30 to 12:00 yields two separate 12:00 notices).
5. Only today's runs (Europe/London service date from the server clock) are recorded or processed. An event processed after UK
   midnight expires without notices. Existing notices stay in the inbox.
6. Baseline: the pre-state is read inside the transaction at the first edit, so runs that existed before tracking never look like a
   new assignment and no retrospective notices are created.
7. The inbox API (`/api/logistics/driver-notifications`) takes the vehicle only from the signed vehicle PIN session. Read state is
   stored per notice, shared by the vehicle; it is not evidence that a named person read an alert.

## Coverage matrix

| # | Trigger | Authoritative write path(s) | Event source | Vehicle(s) notified | Notification | Tests | Status |
|---|---------|-----------------------------|--------------|---------------------|--------------|-------|--------|
| 6 | Stop order changed | `set-run-stop-order` | Staged in the planner transaction | The run's vehicle | Route order updated | Route-to-inbox flow, idempotent no-op, stale version, rules | **Complete** |
| 7 | Departure / return time changed | `update-run-timing` | Staged in the planner transaction | The run's vehicle | Departure / Return time changed | Route-to-inbox flow, rapid edits, failure and retry, immutability, rules | **Complete** |
| 1 | New run assigned (populated) | `assign-job-to-load`, `assign-group`, `assign`, `move-stop` onto a run | None yet | Target vehicle | New run assigned | Rules only | **Outstanding** |
| 2 | Delivery or collection added | `assign-job-to-load`, `assign-group`, `assign`, `save-movement` | None yet | Target vehicle | New delivery / collection assigned | Rules only | **Outstanding** |
| 3 | Delivery or collection removed | `unassign-requirement`, `unassign-movement`, `remove-job-from-load`, `return-stop-to-planning` | None yet | Losing vehicle | Stop removed / Load details changed | Rules only | **Outstanding** |
| 4 | Work moved between vans | `move-stop`, re-assignment through `assign-job-to-load` | None yet | Losing and gaining vehicle only | Work reassigned / New delivery assigned | Rules only (incl. partial load, retired source run) | **Outstanding** |
| 5 | Scheduled time changed | `schedule-stop`, `clear-stop-schedule`, `reschedule-delivery-loads`, `clear-collection-load-schedule` | None yet | The run's vehicle | Collection / Delivery time changed | Rules only | **Outstanding** |
| 8 | Load quantity or contents changed | Upstream amendment through `reconcile-logistics-day` / materialisation | None yet | The load's vehicle | Load details changed | Rules only | **Outstanding** |
| 9 | Delivery instructions changed | Upstream amendment through reconciliation; load notes | None yet | The run's vehicle | Delivery instructions updated | Rules only | **Outstanding** |
| 10 | Run cancelled or withdrawn | Upstream withdrawal through reconciliation; run retirement of a populated run | None yet | The run's vehicle | Run cancelled | Rules only | **Outstanding** |
| - | Vehicle assignment changed | `update-run`, `repair-run-vehicle-identity` | None yet | Old and new vehicle | Run reassigned / New run assigned | Rules only | **Outstanding** |

Why these remain outstanding: each write path builds its own before and after state in its own way (native stops, projected loads
and jobs, upstream reconciliation). Capturing the exact after-state transactionally means reading the run's legs before the first
write and passing the path's computed next state, not re-reading after commit. That is a per-path change to a live planner
transaction and needs its own regression tests; it has not been done, so it is not claimed.

## Deliberately not instrumented (no notification by specification)

Empty draft run creation (`create-run`, `ensure-vehicle-day-runs`), retirement of an empty run, driver execution
(`mark-*-loaded`, `arrive-stop`, `complete-stop`, `report-issue`, `dispatch-run`, `confirm-returned-to-cpu`), driver label changes
(`set-run-driver`), `set-run-return-required`, unassigned queue edits, planner reads, projection rebuilds and unchanged saves.

## Release prerequisites

- Deploy the two composite indexes in `firestore.indexes.json` **before** the code that queries them
  (`fikaLogisticsDriverChangeEventsV1`: status + committedAt; `fikaLogisticsDriverNotificationsV1`: vehicleId + createdAt desc).
- Optional: a Firestore TTL policy on `fikaLogisticsDriverNotificationsV1.expiresAt` (30 days). Expired notices are already
  hidden on read; TTL only reclaims storage.
- New recurring reads: one bounded pending-event query plus a vehicle-scoped inbox read (at most 50 documents) when a driver
  opens or re-shows the app and when the Notifications tab is opened. There is no polling loop and no new listener.
- Staging only until reviewed. Nothing in this PR sends a push; PR 2 adds Web Push.
