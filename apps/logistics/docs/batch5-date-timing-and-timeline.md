# Batch 5: date isolation, timing and timeline geometry

## Service-date request generations

Desktop day reads capture an immutable `(serviceDate, generation)` context. Week summaries capture `(weekCommencing, generation)`. `ScopedRequestCoordinator` deduplicates only within that exact context and permits UI commits only while that context is active. A completed read may still finish and populate its matching date cache, but its cached, head, projection, incremental-convergence, error and freshness results cannot change another active date or week.

Date selection clears day-owned data immediately and remounts the planning coordinator keyed by service date. Pending placement, response authority, inspector, expansion and assignment state therefore cannot be used against a newly selected day. Commands already sent are allowed to finish; their refresh/reconciliation remains scoped to the date that issued them. The mobile workflow uses the same generation gate for cache/head/projection results and date-owned stop, issue, undo, retry and pending-action state. Its 30-second refresh cadence is unchanged.

## Canonical timing replacement and clear

A native stop has one timing value: `plannedArrivalTime` or `plannedWindow`. Every timing edit removes both old fields before writing the new value, including when a window end is omitted. A delivery load follows the same replacement rule independently for its delivery and collection lanes. Clearing a projected schedule sends `clear-delivery-load-schedule` or `clear-collection-load-schedule` against the canonical load ID and expected load version. The server checks current ownership, run planning lifecycle, assignment integrity and projection currency, then removes only that lane's timing fields, increments version/audit, appends its change event and rebuilds the day projection. Clearing a schedule does not unassign work or change the other lane.

## Shared operational bounds and end resize

The mounted planner and server share quarter-hour scheduling constants. Valid schedulable values run from `00:00` through `23:45`; the end of an explicit same-day window must also be no later than `23:45`, and its duration must be at least 15 minutes. The timeline's `24:00` label is a day-boundary decoration, not a schedulable HH:mm value. The legacy 17:00 validator limit belonged to the narrower dispatch view and conflicts with the mounted planner's full-day axis.

An explicit-window right-edge resize carries `resizeEndOnly`. The server verifies the expected stop/load version, confirms the submitted start is still the canonical start, checks the current planning lifecycle and collision set, and rejects with 409 if preserving the start would conflict. Successful responses contain the exact accepted start/end. Ordinary moves keep their existing collision settlement behaviour.

## True-duration geometry

An explicit-window card, its pointer hit area, move origin, optimistic preview, drag ghost and resize edge all use `(end - start) × current pixels-per-minute`. Zoom and fit only change the scale. Short labels clip within the true-duration rectangle and expose a title and accessible label. Arrival-only work uses a separate fixed marker while retaining its 15-minute operational occupancy for visual subrow packing.

## Remaining work

Batch 5 does not address B1 mutation/event atomicity or post-commit HTTP uncertainty. B6's broader production placement-coordinator proof architecture remains deferred. This document does not claim either item complete.
