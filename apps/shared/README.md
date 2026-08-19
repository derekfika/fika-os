# Shared downstream seam

`FulfilmentRequirement` is the bounded handoff between upstream operational truth and future Logistics:

`Hospitality / CPU Production Orders` + `Published Menu allocations` + `Grab & Go submitted orders` → `FulfilmentRequirement` → future Logistics.

The contract is a downstream projection. Upstream domains continue to own booking, production, publication and ordering truth. It contains canonical source and destination identities, snapshots, quantities, versions, provenance, idempotency and minimal lifecycle status, but no route, driver, vehicle or proof-of-delivery concerns.
