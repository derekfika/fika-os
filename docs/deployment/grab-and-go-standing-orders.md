# Grab & Go standing orders

Scope: Delivered-In Grab & Go only. A standing order is a versioned per-OPLOC template; it only ever produces **ordinary canonical Grab & Go orders** (`applyOrderAction` → `saveGrabAndGoOrderHosted` → handoff outbox → Hub Production Order → Fulfilment Requirement → Logistics). There is no second production or fulfilment authority. Release and UAT procedure: [grab-and-go-standing-orders-release.md](grab-and-go-standing-orders-release.md).

This code does **not** create, enable or trigger a Cloud Scheduler job. Until a job is separately approved and created, orders are generated only when an authorised person presses "Create now…".

## Schedule (Europe/London, BST/GMT aware)

| Delivery | Generated | Cut-off (unchanged) |
|---|---|---|
| Wednesday | Monday 12:01 | Tuesday 12:00 |
| Monday | Thursday 12:01 (the Thursday before) | Sunday 12:00 |

A delivery date is **due** when its generation time has passed **and** its cut-off is still open. A scheduler run creates an order only for due dates, so:

- a missed run is recovered by any later run until the cut-off (bounded: at most the next two deliveries are ever due), after which the date is reported as *Not generated · cut-off passed* and never backfilled;
- repeated or concurrent runs are no-ops (deterministic order id + transactional create);
- activating, amending or resuming a template **never creates orders**. Amendments only synchronise automatic orders that already exist and are still editable.

Rotation anchor, Monday/Wednesday service days and catalogue eligibility are reused from `lib/grab-and-go.ts`.

## Model

- One template head per canonical OPLOC; immutable version records for every change (action, actor, time, changed slots, note).
- Slots: rotation week 1–4 × Monday/Wednesday, each independently editable; absent slot = nothing ordered; products must be offered by the governed CPU catalogue for that week and weekday.
- Status: `draft` → `active` ⇄ `paused`; `draft|active|paused` → `terminated`. Saving a terminated template starts a new draft (`cycle` + 1).
- A submitted one-off order can populate its slot (`populate-slot`).

## Generated orders

- Order id is the existing `grab-and-go:{oplocId}:{date}`, shared with manual orders, so one date can never hold two orders.
- `source` (template id/version, slot, trigger, generatedAt) + `control: "automatic"` identify them. A manual amendment/cancellation sets `control: "manual"` (provenance kept); the template never touches a manual order again.
- Cancelled orders are never recreated (including after pause/resume or amendment). A cancelled date cannot be re-submitted in the existing ordering flow either.
- Template amendment before cut-off → new order version (`amend`) + new handoff event; a removed slot → `cancel`. After cut-off nothing changes.
- Actor on scheduler-generated orders is the person who last authorised the template; manual generation is attributed to the person who pressed the button (`trigger: manual-run`). No synthetic identity.
- Unavailable catalogue lines fail closed for that date and are shown as an exception; lines are never dropped.

## Pause vs cancellation (distinct on purpose)

| Action | Effect |
|---|---|
| Pause generation | Stops future generation. Cancels nothing. |
| Terminate | Ends the template. Cancels nothing. |
| Cancel one order | Existing Orders-tab cancellation of a single submitted order. |
| Cancel outstanding automatic orders | Explicit action for a *paused/terminated* template; cancels only automatic, submitted, editable orders (never manual ones). |

Every cancellation is an order version committed **together with** its CPU handoff event. If CPU cannot be reached the result is reported as *recorded, not complete*; the delivery row shows "Pending · not yet in CPU" with a Retry action, the existing outbox recovery worker also retries, and the operation is stored as an audit record with `complete: false`. Success is only claimed when the handoff is delivered.

## Atomicity and concurrency

- Each order write checks the template head (version + allowed status) inside the same Firestore transaction as the order and its handoff event.
- Template changes are compare-and-set on `expectedVersion`.
- Manual generation is limited to the next two open delivery dates (the same dates the ordering UI offers), requires an active template and the current template version, and cannot override cut-off, catalogue or manual orders.

## Persistence and ID safety

Collection `fikaDeliveredInGrabAndGoStandingOrdersV1`, three record types, all `schemaVersion: 2`: `head` (doc id sha256 of `grab-and-go-standing:v2:{oplocId}`), `version` (`…:v{n}`), `operation` (`…:op:{uuid}`). Legacy documents (ids derived from `standing:{orderId}`, no `schemaVersion`/`recordType`) cannot collide (different id namespace) and are never read: the scheduler query requires `recordType == "head"`, direct reads require `schemaVersion === 2 && recordType === "head"`, and a non-v2 document sitting at a v2 id is never overwritten (409). The read-only census (`scripts/standing-uat-report.ts census`) proves this against any environment before release.

## Endpoints

- Site: `GET|POST /api/delivered-in/grab-and-go/standing-orders` — Grab & Go service access and authorised-OPLOC scope (same as ordering); actor is the signed-in email, never client-supplied. Actions: `save`, `populate-slot`, `activate`, `pause`, `resume`, `terminate`, `cancel-upcoming`, `generate`.
- Internal: `POST /api/internal/grab-and-go-standing-orders` — `x-fika-internal-token` only. Body `{}` / `{ "limit": 1–50 }` / `{ "oplocId": "oploc:…" }`. Scans at most `limit + 1` active templates and looks at ≤ 3 dates each. No date override.

## Tests

`npm test` (mocked Firestore, 27 standing-order tests + existing suite), `npm run test:emulator` (real Firestore emulator: contention, races, recovery, read-only report), and `apps/integration-hub/tests/grab-and-go-standing-downstream.test.ts` (Hub Production Order + Logistics fulfilment requirement across v1/v2/v3, replay, out-of-order).
