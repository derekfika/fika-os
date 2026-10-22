# Logistics physical Stops (visits) and collection location

Status: implemented, not deployed. Code: `lib/stop-visits.ts`, `lib/load-assignment.ts`, `app/api/logistics/route.ts`, `lib/projection-dashboard-adapter.ts`, `lib/run-stop-order.ts`, `app/run-organiser.tsx`, `app/visit-chooser.tsx`.

## Decisions

1. **A collection happens at the customer.** Collection stops resolve to `DeliveryLoad.destinationOplocId` (and its label). `originOplocId` (CPU) is never rewritten and is only the eventual return destination. Conflict checks for the collection lane compare customers, not CPU.
2. **A physical Stop is a *visit*.** One visit can hold many deliveries, collections and movements, each still individually tracked.

## Contract (smallest safe extension)

`DeliveryLoad` gains two optional **per-leg** fields:

| Field | Meaning |
| --- | --- |
| `deliveryVisitId` | the physical visit the load's *delivery* leg belongs to on `runId` |
| `collectionVisitId` | the physical visit the load's *collection* leg belongs to on its collection Run |

* Legs sharing an id are one Stop. The same id on a delivery leg and a collection leg is one **mixed** Stop.
* A load's two legs are separate fields because they may be on different Runs/vehicles and so in different visits.
* All legs of one visit are on one Run and one customer; the server enforces this on every assignment and reschedule.
* Membership is by explicit id: never display name, never OPLOC alone, never planned time. Editing a load's time on the same Run cannot split a visit. Moving a leg to another Run re-resolves its visit.
* Run order is stored on the existing `Run.orderedStopIds`. A visit is named `projection-visit:<visitId>`; legacy lane stops keep `projection-stop:<lane>:<loadId>`; native stops keep their `DeliveryStop.canonicalId`. `set-run-stop-order` validates an exact permutation of the Run's physical stops (any member id of a visit names it).
* The read model adds `visitId` to projected lane stops; Organise Run groups by it. The driver app keeps lane-specific execution stops but orders them by the saved sequence, numbers them by visit and notes "same visit as the …".

### Why not reuse `DeliveryStop` for load-backed work?
`DeliveryStop` documents are *execution-bearing* (native readiness, `loaded`, outstanding-work and completion logic read them). Mirroring load legs into stop documents would double-count work in `assertRunReady`/`workOutstanding` and create a second source of truth for execution. Native movements already use `DeliveryStop` as the visit (one stop per Run + OPLOC); that path gains `newVisit` / `targetStopId` instead.

## Assignment policy (`chooseVisit`)
For work arriving at customer *C* on Run *R*: an explicit `visit` (`"new"`, a visit id, or `member:<loadId>` for a legacy placement) wins; otherwise one unambiguous visit is joined; none starts a new visit; **several → 422 `LOGISTICS_VISIT_CHOICE_REQUIRED`** and the planner asks Franco (New visit is always offered). Unscheduled collection legs are queue work and never join targets. A job already on the target Run keeps its visit, so replays are idempotent.

## Compatibility (documented path for historical loads)
* Loads without the fields are *legacy*. They project and execute exactly as before: identical placement (run, vehicle, OPLOC, window, collection fields) = one stop. No migration or backfill job is required to read them.
* A legacy placement receives an explicit id only when work is deliberately joined to it, in the same transaction (`visit-association-backfilled` audit entry + change event). Callers' expected load versions are checked against the pre-backfill version.
* The projection merge key, projected execution grouping and stop-order validation use one function (`projectionGroupKey` / `physicalStopKey`), so they cannot disagree. With a visit id the planned time is intentionally not part of the key.
* Collection stops that previously showed "CPU production" now show the customer; execution commands and ids are unchanged.

## Execution safety
Stop-level actions still operate on the projected placement group for a single lane. Subload actions affect one job. Loading/delivering one job never completes a sibling in the same visit, the opposite lane, or another visit (covered by emulator tests).

## Known limitations
* Delivery loads in one visit whose *collection* configuration differs (one collects, one does not) form two projected groups with the same `visitId`: Organise Run shows one row; the driver app shows adjacent entries marked as the same visit.
* Bulk moving a whole visit sets every member to one planned time; individual edits keep per-load times.
* Same-OPLOC time-collision avoidance still treats the same customer as non-conflicting.
