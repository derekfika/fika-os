# Human Decision Required — Pack 9 Provider Mappings

## PACK9-GATE-001 — First Provider Mapping and Accountable Owner

### Question

Which provider context shall be the first Pack 9 mapping, and which organisational role shall be accountable for that mapping?

### Relevant evidence

- Packs 1–8 are complete and integrated in the local repository.
- Email ingestion is a live transitional Booking adapter with strong repository evidence.
- Google Calendar is a live transitional Production-ingestion adapter with documented loss and ambiguity.
- Square, Goodtill and SumUp do not yet have a completed till-domain canonical target.
- BrightHR does not yet have a completed Workforce canonical target.
- No accountable provider/integration mapping role is confirmed.

### Alternative A — Email ingestion to Booking

Begin with the legacy email-ingestion-to-Booking mapping. Assign one role-based accountable provider/integration owner working with the Booking domain owner.

### Alternative B — Google Calendar to Production

Begin with the Google Calendar-to-Production mapping. Assign one role-based accountable provider/integration owner working with the Production domain owner.

### Alternative C — Defer Pack 9

Do not select a first mapping yet. Pack 9 remains blocked without creating mapping artefacts.

### Recommendation

Alternative A. It supports the confirmed authoritative Booking path while preserving the Angel Court legacy adapter. Business authority is required to select the first provider context and name the accountable organisational role.

### Required response

- **First Provider Mapping:** Alternative A, B or C
- **Accountable Owner Role:** required for Alternative A or B

### Impact on later work

This decision determines the first governed provider contract, the applicable canonical schema scope and the accountable mapping owner. No Provider Mapping shall be invented before this decision is supplied.

## Repository effect

None. Pack 9 remains staged and blocked only by this Human Decision Gate.
