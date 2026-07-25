# Pack 6 BDR-to-Schema Traceability

## Production Order

| Schema element | Authority | Treatment |
|---|---|---|
| Stable Production Order identity | PROD-001; SVC-003; repository schema rules | Independent Production-domain identity. |
| `sourceBooking.bookingId` and `bookingVersion` | PROD-001; PROD-004; ADR-004 supporting boundary | Required immutable source traceability. |
| `ownership` | PACK6-GATE-001; Authority Model | Role-based ownership for the order; no department is fixed. |
| `eligibility.operationalFulfilmentRequired` | PROD-001; PACK6-GATE-002 | Only Bookings requiring operational fulfilment create Production Orders. |
| `lifecycleStatus` | PACK6-GATE-002 | Restricted to Requested, Planned, In Production and Completed. |
| prerequisites | PROD-001 | Represents conditions that may hold approved Production work. |
| `customerCommitment` | PROD-002 | Projection of Booking-owned service and expected-delivery timing. |
| `productionTiming.requiredReadyAt` | PROD-002; PACK6-GATE-005 | Mandatory Required Ready Time owned by Production. |
| optional `productionStartAt` | PACK6-GATE-005 | Optional Production Start Time. |
| line and routing references | PROD-003; PROD-005 | Keeps quantity/rule and facility-allocation records explicit. |

## Production Line

| Schema element | Authority | Treatment |
|---|---|---|
| source Booking Item references | BOOK-002; PROD-003 | Preserves what was ordered without transferring Booking ownership. |
| `ownership` | PACK6-GATE-001; Authority Model | Role-based line ownership may differ from its order or other lines. |
| ordered snapshot | BOOK-002 | Retains purchased quantity and unit. |
| production quantity | BOOK-002; PROD-003 | Production-owned preparation quantity and unit. |
| rule snapshot references | PROD-003 | References preparation unit, yield, conversion, recipe, batch and aggregation rules without inventing catalogues. |

## Routing Allocation (`production-routing-allocation.schema.json`)

| Schema element | Authority | Treatment |
|---|---|---|
| multiple allocations | PROD-005 | One Booking-derived Production Order may distribute work across facilities. |
| `operationalLocationId` | PROD-005; LOC-001; PACK6-GATE-003; PACK6-GATE-004 | Production location uses the existing OPLOC identity. |
| Production capability enablement reference | CAP-001; PACK6-GATE-004 | Confirms that Production capability is enabled at the OPLOC. |
| routing basis | PROD-005 | Requires routing rule, capacity assessment and delivery requirement references. |

## Production Change Record

| Schema element | Authority | Treatment |
|---|---|---|
| original and changed snapshots | PROD-004; BOOK-006 | Preserves history rather than overwriting. |
| approval and occurrence time | PROD-004; Authority Model | Identifies approving person/authority and when the change occurred. |
| automatic update/cancellation before commencement | PROD-001; PROD-004 | Encoded as valid handling alternatives. |
| notification and human review after commencement | PROD-004 | Required when production has begun. |

## Cross-pack dependencies

- Pack 1: Operational Location identity.
- Pack 2: role assignment and authority references.
- Pack 2: Production capability enablement.
- Pack 4: Booking, Booking Item, quantity/unit and amendment source records.
- Pack 3: Production remains independent from Service.
