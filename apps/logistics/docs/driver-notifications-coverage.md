# Driver notifications: capture coverage

Status of PR 1 (durable capture, persistent vehicle-scoped inbox, Notifications tab). Web Push is PR 2.

Every operational trigger below is captured by the same mechanism and proven through the real planner route (or the real
reconciliation transaction), not by calling the rules directly. Remaining limits are listed explicitly at the end; nothing is
claimed beyond them.

## Architecture

0. **Delivery guarantee (read this first).** Once an event is staged, delivery to the inbox is guaranteed to be eventually
   consistent: the event commits atomically with the planner change, processing is retried and also recovered by the scheduler.
   *Staging the event itself is best-effort*: if capture throws, the planner save still commits (Franco's planner is never
   disrupted), but no event exists and the change cannot be rebuilt later. That case is made visible, not silent: a
   `[driver-notifications] CAPTURE GAP` error log (alert on it), a durable `fikaLogisticsDriverCaptureGapsV1` record with status
   `open`, and `openCaptureGaps` in the recovery route's response. Only the final transaction attempt counts, so a retried
   transaction that captures cleanly leaves no gap. Capture is **not** guaranteed under all failures; if both the gap record and
   the log line were lost, the miss would be undetectable. Operators clear a gap by checking the affected run with the driver.
1. A write that changes a driver-visible run stages one immutable `DriverChangeEvent` **inside the same Firestore transaction**.
   Planner actions go through `authorizeTransaction`; upstream reconciliation, `save-logistics-job`, `repair-run-vehicle-identity`
   and `reset-planning-day` go through `runCapturedTransaction` (`lib/driver-change-capture.ts`). Both buffer the writes, resolve the
   runs the write can affect (directly, or through a load, stop, assignment or job, before and after), read only those runs' loads,
   assignments, jobs and stops, build the driver-visible before and after snapshots, and stage the event only when a
   driver-visible difference exists. Capture is scoped to the affected runs, not the day: on a 324-document day it reads about 31
   documents per edit instead of 327, and edits to Van 1 and Van 2 no longer contend. Authorization has already passed; a capture problem is logged and never
   blocks the save.
2. Event identity is the action plus every entity version the mutation advanced (`driverChangeEventId`). Staging reads first and
   creates only if absent, so a retry or concurrent duplicate cannot overwrite a processed event or reset it to pending.
3. After the commit, `processDriverNotificationsSafely` turns pending events into inbox notices from the event's own snapshots. A
   processing failure never fails the save; the event stays pending, is retried (bounded to 8 attempts, then parked as `failed`)
   and is also recovered by the **server-owned** processor route (see Release prerequisites). Vehicle sessions cannot trigger
   processing.
4. Notices are keyed by event + subject, so replays and duplicate delivery create nothing new while later independent changes stay
   distinct.
5. Only today's runs (Europe/London service date from the server clock) are recorded or processed. An event processed after UK
   midnight expires without notices. Existing notices stay in the inbox.
6. The pre-state is read inside the transaction at the first edit, so runs that existed before tracking never look like a new
   assignment and no retrospective notices are created.
7. The inbox API (`/api/logistics/driver-notifications`) takes the vehicle only from the signed vehicle PIN session. Read state is
   stored per notice, shared by the vehicle; it is not evidence that a named person read an alert. The unread badge comes from a
   server-side aggregate count (exact up to 100, shown as "99+" above 99), independent of the 50-item list page. Expiry understands
   real Firestore `Timestamp` values.

## Coverage matrix

All rows are proven by `tests/driver-notifications-triggers.test.cjs` (real route, frozen clock), `tests/driver-notifications-flow.test.cjs`
and `tests/driver-notifications-api.test.cjs`, plus the Firestore emulator suite for the storage behaviour.

| # | Trigger | Authoritative write path(s) | Vehicle(s) notified | Notification | Status |
|---|---------|-----------------------------|---------------------|--------------|--------|
| 1 | Delivery or collection added to today's run | `assign-job-to-load`, `assign`, `assign-group`, `save-movement`, `move-stop` | Target vehicle | New delivery / collection assigned; Load details changed when added to an existing stop | **Complete** |
| 2 | New run assigned (populated) | any of the above onto a run the vehicle did not have | Target vehicle | New run assigned | **Complete** |
| 3 | Delivery or collection removed | `remove-job-from-load`, `unassign-requirement`, `unassign-movement`, `return-stop-to-planning`, upstream withdrawal | Losing vehicle | Load details changed (item) / Stop removed (last item) | **Complete** |
| 4 | Work moved between vans, including partial loads | `reschedule-delivery-loads` with a target run, `move-stop`, `assign-job-to-load` onto the other van | Losing and gaining vehicle only, once each | Work reassigned ("Part of the delivery ... moved" when part stays) / New delivery assigned | **Complete** |
| 5 | Scheduled delivery or collection time changed | `schedule-stop`, `clear-stop-schedule`, `reschedule-delivery-loads`, `clear-collection-load-schedule` | The run's vehicle | Delivery / Collection time changed (old and new times) | **Complete** |
| 6 | Load quantity or contents changed | Upstream amendment through `reconcile-logistics-day` / materialisation (`reconcileRequirementJob`) | The load's vehicle | Load details changed | **Complete** |
| 7 | Delivery instructions changed | `save-logistics-job` (notes); an identical re-save is not a change | The run's vehicle | Delivery instructions updated | **Complete** |
| 8 | Run cancelled or withdrawn | `reset-planning-day`; upstream withdrawal | The run's vehicle | Run cancelled / Stop removed | **Complete** |
| 9 | Vehicle assignment changed | `update-run`, `repair-run-vehicle-identity` | Old and new vehicle | Work reassigned / Run assigned | **Complete** |
| 10 | Stop order changed | `set-run-stop-order`, `reorder` | The run's vehicle | Route order updated | **Complete** |
| 11 | Departure / return time changed | `update-run-timing`, `update-run` | The run's vehicle | Departure / Return time changed | **Complete** |

**What each row rests on.** Paths with their own route-level test: `assign-job-to-load`, `remove-job-from-load`,
`reschedule-delivery-loads` (same van and to the other van), `schedule-stop` (native stop), `update-run` (vehicle change),
`update-run-timing`, `set-run-stop-order`, upstream reconciliation (quantity change and withdrawal), `save-logistics-job`,
`repair-run-vehicle-identity` and `reset-planning-day`. The other actions named in the table (`assign`, `assign-group`,
`save-movement`, `move-stop`, `unassign-*`, `return-stop-to-planning`, `clear-*-schedule`, `reorder`) pass through the same capture
hook but have no dedicated route test; they are covered by the mechanism, not individually proven.

Cross-cutting behaviour tested for the triggers: correct destination van (the other van never hears anything), replay with stale
versions adds no event, two simultaneous identical requests commit one change and one notice, tomorrow's runs record nothing, and
driver execution never creates events.

## Known limits (not claimed as covered)

- **Capture failures** are visible but not recoverable (see the delivery guarantee above).
- **Writers outside the two capture paths.** Any future write path that does not use `authorizeTransaction` or
  `runCapturedTransaction` will not be captured. There is no such path in `app/api/logistics/route.ts` or the reconciliation code
  today; new paths must adopt one of the two helpers.
- **Hub-driven changes are captured when Logistics reconciles them**, not when the Hub emits them: a change the Hub has not yet
  pushed or Logistics has not yet reconciled cannot notify.
- **Instruction changes** are captured from `save-logistics-job` only; upstream sources do not currently carry delivery notes.
- **Read state is per vehicle**, not per driver.

## Deliberately not instrumented (no notification by specification)

Empty draft run creation (`create-run`, `ensure-vehicle-day-runs`), retirement of an empty run, driver execution
(`mark-*-loaded`, `arrive-stop`, `complete-stop`, `report-issue`, `dispatch-run`, `confirm-returned-to-cpu`), driver label changes
(`set-run-driver`), `set-run-return-required`, unassigned queue edits, planner reads, projection rebuilds and unchanged saves.

## Release prerequisites

- Deploy the three composite indexes in `firestore.indexes.json` **before** the code that queries them:
  `fikaLogisticsDriverChangeEventsV1` status + committedAt; `fikaLogisticsDriverNotificationsV1` vehicleId + createdAt desc;
  `fikaLogisticsDriverNotificationsV1` vehicleId + readAt + expiresAt (unread count). Wait for them to finish building.
- **Server-owned recovery** (full runbook: `apps/logistics/docs/driver-notifications-scheduler.md`). `POST /api/logistics/driver-notifications/process` is authenticated by the internal service token
  (`x-fika-internal-token`, `FIKA_INTERNAL_API_TOKEN`) exactly like `/api/logistics/invalidate`, processes at most 50 pending events
  and returns counts only. A Cloud Scheduler job should call it every five minutes (same pattern as
  `docs/deployment/integration-hub-logistics-outbox-scheduler.md`). It is a safety net: the normal path processes immediately after
  each save. The scheduler job is **not created** by this PR.
- Optional: a Firestore TTL policy on `fikaLogisticsDriverNotificationsV1.expiresAt` (30 days). Expired notices are already hidden
  on read and excluded from the count; TTL only reclaims storage.
- New recurring reads: on a planner write of a non-excluded action that affects a run for today's service date, capture reads those
  runs' documents, loads, assignments, jobs and stops once (about 31 documents for a typical single-run edit, measured on a
  324-document day; skipped entirely when no affected run is today's). Measured with
  `tests/emulator/driver-capture-load.emulator.test.ts`. On the driver side, one
  vehicle-scoped inbox query (at most 50 documents) plus one aggregate count when the app opens or re-shows and when the
  Notifications tab is opened. No polling loop and no new listener.
- Real-Firestore tests: `npm run test:emulator` in `apps/logistics` (run under `firebase emulators:exec`). CI wiring needs an edit to
  `.github/workflows/validate.yml`, which another workspace holds (`feat-034-shared-ci`); until it lands these run locally and the
  six phone-width Playwright tests (`mobile-notifications-chromium`) are also local-only.
- Staging only until reviewed. Nothing in this PR sends a push; PR 2 adds Web Push.
