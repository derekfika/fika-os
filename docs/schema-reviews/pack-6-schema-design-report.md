# Pack 6 Schema Design Report

Pack 6 produces four narrow draft Production schemas from PROD-001 through PROD-005 and their explicitly referenced Booking and Operational Location decisions.

The schemas are fixed human-review candidates. They are not adopted, not implementation models and not authorised for repository integration.

## Schemas

### Production Order

Owns production intent derived from one operational-fulfilment Booking version, role-based ownership, the four-state lifecycle, customer-commitment projection, mandatory Required Ready Time, line and routing references, prerequisite evidence and audit history. It does not own commercial Booking status or price.

### Production Line

Preserves source Booking Item references and the ordered quantity snapshot while owning its role-based responsibility, production quantity, preparation unit and references to applied conversion, yield, recipe, batch and aggregation rules.

### Production Routing Allocation

Allocates one or more Production Lines to an Operational Location with Production capability enabled, using routing-rule, capacity-assessment and delivery-requirement references. No separate Production Facility concept is introduced.

### Production Change Record

Preserves the original and changed Booking snapshot references, approving authority, timing and handling. Before production commences, amendments update and cancellations cancel automatically. After commencement, either change requires operational notification and human review.

## Deliberately excluded

- Commercial Booking status and price.
- Provider, Calendar, Sheet, dashboard or parser fields.
- Any Production lifecycle states beyond Requested, Planned, In Production and Completed.
- A separate Production Facility concept.
- Definitive unit, conversion, yield, recipe, batch or aggregation catalogues.
- Human-review outcome catalogue and operational workflow state.

## Governed Pack 6 decisions

- Only Bookings requiring operational fulfilment generate one or more Production Orders.
- Production ownership is role-based and may vary by order, line or context.
- Production is location-independent; central and on-site work are not separate canonical concepts.
- Production occurs at an Operational Location with Production capability enabled.
- Required Ready Time is mandatory; Production Start Time is optional.

## Validation

- Schema files: 4
- Valid fixtures passed: 4
- Invalid fixtures failed as expected: 4
- Failures: 0
