# Shared downstream seam

`FulfilmentRequirement` is the bounded handoff between upstream operational truth and future Logistics:

`Hospitality / CPU Production Orders` + `Published Menu allocations` + `Grab & Go submitted orders` → `FulfilmentRequirement` → future Logistics.

The contract is a downstream projection. Upstream domains continue to own booking, production, publication and ordering truth. It contains canonical source and destination identities, snapshots, quantities, versions, provenance, idempotency and minimal lifecycle status, but no route, driver, vehicle or proof-of-delivery concerns.

Cross-domain writes also emit `DurableDomainEvent` records. Menu Planning and
Delivered-In persist their outbox alongside their local JSON state; the
Integration Hub stages Firestore-backed production events in the same
transaction as the Production Order write. Event IDs are deterministic from
event type, aggregate identity and source version, so replay is safe. Failed
delivery remains marked with retry metadata, and the shared reconciliation
helper reports missing, stale, withdrawn and failed handoffs.

Business seam:

`Upstream state → durable domain event/outbox → FulfilmentRequirement → future Logistics`

The existing CPU SSE/polling path remains a UI freshness mechanism only; it is
not used as the durable business handoff.
