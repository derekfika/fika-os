# OAC legacy recovery — redacted evidence summary

**Evidence date:** 2026-11-07
**Status:** Preview only; no migration or downstream writes

## Inventory and exact-key lineage

- The bounded source inventory contains **169 unique legacy booking references**. All 169 nested booking payloads parsed successfully. Source statuses are 110 archived, 38 cancelled, 13 confirmed, and 8 needing review. Twelve of the confirmed records are future-dated; one is past-dated. Twenty-four rows have no service date.
- Exact-key searches across current canonical bookings, Production Orders, Fulfilment Requirements, and Logistics records found **zero deterministic matches** for those 169 references. This does not rule out semantic matches in unstructured historical evidence.
- Two existing canonical bookings at the site were inspected separately and are not exact-ID matches. Their Production, Fulfilment and Logistics history remains unchanged; one has a production review requirement, and the cancelled booking has withdrawn downstream records.

## Future confirmed candidates

**Disposition: 0 ready, 12 held.** All 12 source row IDs match their nested booking IDs and have unique nested booking-object, quote, and Calendar references. Those references are evidence of the legacy source only; stale flags do not prove current Hub or Calendar state.

- All 12 linked quote documents are accessible and currently marked **Draft**. Their visible current content matches the row's date, guest count, start time and totals. They are not current Hub quote revisions or saved Hub quote PDFs.
- Calendar event state is **unknown**. The connected Calendar account cannot access the configured legacy calendar; exact event reads returned not found. This does not prove that the events were deleted.
- Two rows have manual-edit evidence. One row has a date conflict between its current row and quote versus its retained original-source consistency data.
- One legacy item alias is approved. Seven candidates contain only that alias; five contain additional proposed or unresolved aliases.
- Four Deli quantities are below the current catalogue minimum of ten; two are also below the linked Draft terms' minimum of eight.
- None of the 12 records has a source end time. Do not infer an end time or create Calendar/Logistics windows from missing data.

## Preview and safety outcome

Merged preview-only implementation [PR #469](https://github.com/derekfika/fika-os/pull/469) evaluated a source-hash-bound snapshot: 169 source rows, 13 held, 156 excluded, zero preview creates, zero exact existing matches, and zero writes or downstream effects. No candidate currently meets the evidence and authority gates for an isolated import rehearsal or production migration, so neither was run.

No source row, quote, Calendar event, canonical booking, CPU order, Fulfilment Requirement, Logistics job, notification, or legacy trigger was changed.

## Decisions required before a fresh rehearsal

1. Resolve and authorize the two manual edits and the original/current date conflict while preserving original source evidence.
2. Decide how legacy `CONFIRMED` rows and Draft quote documents map to current booking and quote states. Drafts must not be promoted to accepted quote evidence by inference.
3. Approve or resolve the five candidates with extra item aliases, and reconcile all four below-minimum quantities without rewriting source values.
4. Verify the legacy Calendar events and ownership through an account with access to the configured calendar.
5. Decide whether booking-only records without end times may be imported, without creating inferred schedule windows.
6. Pin a fresh complete source snapshot and recompute its hash-bound preview immediately before any later rehearsal.

The detailed booking-level inventory and source artifacts remain in authorized private evidence storage; this repository note contains aggregate findings only.
