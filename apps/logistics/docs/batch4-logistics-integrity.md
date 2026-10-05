# Batch 4 — Logistics planning and stop integrity

2026-10-05 — A6-R, A7, A8, A10, and A11. Starting `origin/main`: `dcb7eeb4f824153217927981ac39b053cb16e596`. Deployment: none.

## Planning lifecycle

Canonical Logistics job assignment checks the target run inside the transaction and accepts only the shared planning-open states (`draft` and `planned`). Reassigning an existing job also checks the prior load's delivery and separately owned collection placement before changing it. Delivery and collection rescheduling check their affected current owner and the proposed owner in the transaction. Removing a job checks its delivery owner and any already-scheduled collection owner whose aggregate will change. Existing run/stop/load/job versions and Batch 1 authorization remain in force. Collection preferences remain planning defaults; the endpoint changes only the preference record and does not rewrite an assigned load.

## Transfer identity and order

Transfer membership comes from attached canonical `MovementRequest` IDs and `MovementRequest.type === "transfer"`; persisted `movementType` is interpreted only as the leg role (collection pickup, delivery drop-off). A bounded lookup of the attached movement and its linked stops identifies the counterpart. Missing or ambiguous mappings fail closed. Moving or deferring either transfer leg independently is rejected. Transfer pickup and drop-off may be scheduled separately only when both known start times remain ordered on the same run. Clearing timing remains allowed. Reorder preserves the operator's requested order and validates each transfer pair individually; unrelated collection and delivery stops retain their relative operator order.

## One-off endpoints

Stops without a governed OPLOC receive a stable `oneOffEndpointId` based on canonical MovementRequest identity and endpoint role. Address text is a display snapshot only. Different requests at identical text remain distinct; a retry for the same endpoint resolves the same grouping identity. Governed OPLOC grouping remains unchanged. No new index is required.

Existing records whose `locationOplocId` is empty and lack `oneOffEndpointId` cannot be safely separated from address text alone. Previously combined records may already contain several movement IDs. They remain readable and are not automatically split or rewritten. If live records show coalesced unrelated movements, a governed manual review is required before any corrective data operation; no migration is included here.

## Date isolation and deferral

Ordinary `move-stop` rejects differing source/target service dates inside the transaction. Native `defer-collection` remains the explicit cross-date workflow. Its transaction retains deterministic target-run identity and expected run/stop versions; stale replay therefore cannot create a second target stop/run. After commit, source and target each receive a date-correct change event and an existing projection rebuild using that date's own cursor. The response returns both affected dates and their separate change cursors.

`DeliveryLoad` has one `serviceDate` and a `collectionRunId`, but no independently governed collection service date. Projected collection postponement therefore remains rejected as introduced in Batch 3; no multi-day load shape was inferred or added.

## Legacy review and operational implications

No repository fixture contained a real empty-OPLOC Logistics record or a production inventory of previously planner-mutated ready/dispatched loads. The review inspected current persistence types, materialisation/projection paths, transfer assignment/defer logic, and existing historical deferral behavior. The new guards stop future planner mutations after a run leaves planning. Existing ready/dispatched placements are not changed automatically; operations should review any known historical routes whose placement was edited before these guards. Existing transfer records with missing/ambiguous movement or counterpart records now fail closed for affected move, schedule, reorder, and defer commands.

No migration, index, grant change, projection rebuild, staging/production read, or deployment was performed as part of this change.

## Validation

- Focused route regressions: `node --test tests/batch4-integrity.test.cjs` — 21 passed.
- Planning helper regressions are included in the Logistics standard test command.
- Established Batch 1–3 suites, standard tests, API integration, Chromium journeys, typecheck, nonincremental TypeScript, and production build are recorded in the Batch 4 review response.

Root `CHANGELOG.md` and MNK menu-data edits were preserved byte-for-byte and left uncommitted as explicitly requested.
