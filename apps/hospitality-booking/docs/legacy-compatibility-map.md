# MNK Legacy Compatibility Map

This migration uses the MNK Apps Script booking portal and dashboard as a workflow and data-contract reference only. Neither Apps Script project, its Sheets, Calendar integration, email integration, nor CPU workflow is called by the new React/Firebase path.

## Customer journey retained

- Contact: name, email, phone, company and optional invoice reference.
- Service request: date, start/end time, guest count, floor, room/area or delivery point, and service type.
- Menu lines: source item identifier, category, quantity, selected options/comments, unit price and line total.
- Dietary details, special instructions and the three customer acknowledgements.

## Structured payload compatibility

The new portal submits the legacy-shaped `bookingId`, `submittedAt`, `client`, `event`, `order`, `dietaries`, `acknowledgements` and `specialInstructions` structure to `fika.booking-ingestion.mnk.v1`.

The Canon preserves that original payload as source evidence, then creates a separate canonical Booking commercial snapshot. No data is reconstructed from a Sheet, Calendar event, Gmail message or CPU projection.

## Manager workflow retained and clarified

The reference dashboard reviews a request, creates quotes, creates Calendar entries, confirms and archives work. The pilot preserves the manager review sequence as canonical Booking status changes: `New`, `Reviewed`, `Quoted`, `Approved`, `Completed`, or `Cancelled`. Quote, Calendar and CPU actions are deliberately not automated in this increment.

## Explicit compatibility boundaries

- Legacy MNK `itemId` maps only through a governed `providerMappings` entry with provider `mnk-booking-platform`; display-name matching is prohibited.
- The legacy booking reference is retained in `source.sourceBookingId`; the Canon derives a deterministic immutable Booking ID from it for retry safety.
- Legacy customer intent remains immutable source evidence. Internal actions append governed audit/status history rather than overwriting it.
