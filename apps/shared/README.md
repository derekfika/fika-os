# Shared downstream seam

`FulfilmentRequirement` is the bounded handoff between upstream operational truth and future Logistics:

`Hospitality / CPU Production Orders` + `Published Menu allocations` + `Grab & Go submitted orders` → `FulfilmentRequirement` → future Logistics.

The contract is a downstream projection. Upstream domains continue to own booking, production, publication and ordering truth. It contains canonical source and destination identities, snapshots, quantities, versions, provenance, idempotency and minimal lifecycle status, but no route, driver, vehicle or proof-of-delivery concerns.

Cross-domain writes also emit `DurableDomainEvent` records. Menu Planning and
Delivered-In retain their source outboxes for retry, but their historical
Fulfilment arrays are not downstream truth. They forward Fulfilment events to
the Integration Hub's Firestore-backed `fikaFulfilmentRequirementsV1` store.
Production Orders project into that same collection transactionally with the
order and its source event. The Hub records consumer-specific receipts in
`fikaDomainEventInboxV1`, so event delivery flags are not used as the only
deduplication mechanism. The Hub exposes `/api/fulfilment-requirements` as the
single read contract, plus replay and reconciliation operations.

Business seam:

`Upstream state → durable domain event/outbox → FulfilmentRequirement → future Logistics`

The existing CPU SSE/polling path remains a UI freshness mechanism only; it is
not used as the durable business handoff.
