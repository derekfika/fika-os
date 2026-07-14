# LOC-004: Operational Location Lifecycle

- **Decision ID:** LOC-004
- **Workbook Decision ID:** DEC-LOC-004
- **Status:** Accepted
- **Date:** 2026-07-12T08:31:57.824Z
- **Decision owner:** Derek / Operations / Mobilisation owner
- **Related domains:** Operational Location

## Context

FIKA needs to preserve the identity and history of an OPLOC when work stops, restarts or when duplicate records are discovered. Destroying or silently rewriting the record would break operational continuity and auditability.

## Decision

Always. Closed locations should not be destroyed, just decommissioned. Each transitiion needs senior management approval,

## Business rationale

Closed OPLOCs are decommissioned rather than hard-deleted. Reopening reactivates the same OPLOC, and every lifecycle transition requires senior management approval with retained history.

A merge is exceptional and is used only when evidence confirms that two records represent the same real-world OPLOC. Evidence may include address, physical identity, Client and Client Contact information, historical Bookings and operational activity.

## Positive consequences

- Closed and reopened locations retain one continuous operational history.

- Senior management approval protects important lifecycle changes.

- Confirmed duplicates can be resolved without losing the identity or history of either record.

- Audit and reporting can explain what changed, when and why.

## Trade-offs

- Decommissioned and merged records remain stored and traceable.

- Merge decisions require evidence and cannot be used as a shortcut for ordinary business change.

- Operational processes must distinguish a lifecycle change from a rename, Client change, Type change or reopening.

## Implementation implications

- Future lifecycle workflows must retain transition history, authorisation and reasons, and must not hard-delete OPLOCs.

- When two duplicates are merged, one OPLOC becomes the survivor. The duplicate remains traceable, is marked Merged and permanently references the survivor; historical records must not be silently deleted or rewritten.

- A rename, Client change, Venue-to-Site transition or reopening must continue to use the same OPLOC and is not a merge.

## Related decisions

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-LOC-004, sourced from `Questions!17`.
- [docs/business-workshops/location-domain-workshop-v3.md](../business-workshops/location-domain-workshop-v3.md) — **Historical**; `Decision 1: Canonical Location`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

- Potential lifecycle states and transition rules are Stage 5 considerations, not newly approved canonical values in this BDR.

- Schema work must clarify how decommissioning, reactivation, merge evidence, survivor references and transition approval are represented while preserving the locked Decision wording.

- The existing Decision contains its original punctuation and spelling and must not be normalised without a separately governed amendment.
