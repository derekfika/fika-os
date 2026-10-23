# Grab & Go standing orders

Scope: Delivered-In Grab & Go only. A standing order is a versioned per-OPLOC template; it only ever produces **ordinary canonical Grab & Go orders** (`applyOrderAction` → `saveGrabAndGoOrderHosted` → handoff outbox → CPU Production Order → Fulfilment Requirement → Logistics). There is no second production or fulfilment authority.

This code does **not** create, enable or trigger a Cloud Scheduler job. Until a job is separately approved and created, a standing order only creates orders when a manager activates, resumes or amends it (an immediate, bounded reconciliation) — never on a timer.

## Model

- One template head per canonical OPLOC; immutable version records for every change (action, actor, time, changed slots, note).
- Slots: rotation week 1–4 × Monday/Wednesday, each independently editable. An absent slot never generates an order. Quantities must be offered by the governed CPU catalogue for that rotation week and weekday.
- Status: `draft` → `active` ⇄ `paused`; `draft|active|paused` → `terminated`. Saving a terminated template starts a new draft (`cycle` + 1; version numbers keep counting).
- A submitted one-off order can populate its slot (`populate-slot`), producing a normal template version that references the source order.
- Rotation anchor, Monday/Wednesday service days, 12:00 Europe/London day-before cutoff and catalogue eligibility are reused from `lib/grab-and-go.ts`; nothing is duplicated.

## Generated orders

- Order id is the existing `grab-and-go:{oplocId}:{date}` — the same id a manual order uses, so one date can never hold two orders.
- `source` (template id/version, slot, trigger, generatedAt) and `control: "automatic"` identify them. A manual amendment or cancellation sets `control: "manual"` (provenance is kept); the template never touches a manual order again.
- A cancelled order is never recreated. Dates whose cutoff has passed are never generated or changed (no backfill). Unconfigured slots are never generated.
- Future automatic orders follow template amendments before cutoff by creating a new order version (`amend`) with a new handoff event; a removed slot withdraws the order (`cancel`). Pause/terminate can optionally cancel upcoming automatic orders (explicit choice).
- The actor recorded on a generated order is the person who last authorised the template, with `automation` markers in history; no synthetic identity is introduced.
- Unavailable catalogue lines fail closed: nothing is created or changed for that date and the UI reports an exception. Lines are never dropped.

## Atomicity and concurrency

- Each order write checks the template head (version + allowed status) inside the same Firestore transaction as the order and its handoff event, so a pause/terminate/amendment landing mid-run prevents the stale write.
- Concurrent or replayed runs are idempotent: the second writer sees the existing order and reports `skipped-existing-order`.
- Template changes are compare-and-set on `expectedVersion`.

## Persistence

Firestore collection `fikaDeliveredInGrabAndGoStandingOrdersV1` (already inventoried in the bootstrap tooling). Head doc id = sha256 of `grab-and-go-standing:v2:{oplocId}`; version docs sit in the same collection (`recordType: "version"`). Legacy single-template documents (no `schemaVersion: 2`) are ignored and never rewritten. The version-history query needs the composite index added to `apps/integration-hub/firestore.indexes.json` (`recordType`, `oplocId`, `version desc`); the scheduler's active-template scan uses two equality filters only. Staging and production data are not transferred (see the production bootstrap review).

## Endpoints

- Site: `GET|POST /api/delivered-in/grab-and-go/standing-orders` — Grab & Go service access and authorised-OPLOC scope (the same scope as ordering); the actor is the signed-in email, never client-supplied.
- Internal: `POST /api/internal/grab-and-go-standing-orders` — `x-fika-internal-token` only. Body `{}`, `{ "limit": 1–50 }` and/or `{ "oplocId": "oploc:…" }`; anything else is rejected. Scans at most `limit + 1` active templates and handles up to 5 dates each (14-day horizon). Response lists per-date outcomes (`created`, `amended`, `cancelled`, `skipped-*`, `unavailable-lines`, `template-changed`, `error`) and totals.

## Open dependencies (not done by this change)

1. **Scheduler job (needs approval):** e.g. `0 6 * * *`, `Europe/London`, POST the internal endpoint with the internal token and the same retry configuration as the existing `fika-delivered-in-grab-and-go-outbox-recovery` job. Safe to retry or run twice. For a first rollout to MNK only, send `{"oplocId":"oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f"}`.
2. **Firestore index** deployment for the version-history query (existing index-deploy process).
3. The existing outbox recovery job delivers handoffs that were committed but not yet forwarded; no new worker is needed.
4. A rotation-anchor change (`GRAB_N_GO_ROTATION_WEEK_1_DATE`) re-maps slots to different dates; templates store rotation weeks, not dates.
