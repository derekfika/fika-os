# TYPE-003: Location Type History

- **Decision ID:** TYPE-003
- **Workbook Decision ID:** DEC-TYPE-003
- **Status:** Accepted
- **Date:** 2026-07-12T08:54:24.133Z
- **Decision owner:** Derek / Operations
- **Related domains:** Operational Location

## Context

An OPLOC's fundamental operating model may change while its durable identity remains the same. Type history is therefore required to explain how the location was classified at different times.

## Decision

A Location Type may change over the lifetime of an Operational Location where its fundamental operating model changes. Historical type assignments must be retained with effective dates to preserve reporting, audit history and operational context rather than overwriting previous classifications.

## Business rationale

The current Type may be easy to access, but prior assignments must remain saved with what changed, when, who authorised it and why. Type changes should be rare because they represent a fundamental operating-model change.

OPCAP assignments may change more frequently. Lifecycle, Type, OPCAP and relationship history are distinct histories and must not overwrite one another.

## Positive consequences

- Historical reporting can use the Type that applied at the relevant time.

- FIKA can explain and audit rare operating-model changes.

- Venue-to-Site transitions preserve the same OPLOC identity.

- Capability changes can be traced without falsely implying a Type change.

## Trade-offs

- History grows over time and cannot be discarded merely for convenience.

- Users and reports must distinguish the current Type from prior assignments.

- Type and OPCAP changes require separate histories and approval evidence.

## Implementation implications

- Type assignments must retain effective dates, authorisation and reason instead of overwriting the previous Type.

- Every OPCAP addition, removal or material configuration change should eventually have its own history, separate from Type and lifecycle history.

- Example: in July 2027, Wise changed from Venue to Site because FIKA established an ongoing operational presence. Coffee Bar was added as an OPCAP as part of that change. Adding Coffee Bar did not itself change the Type; explicit approval of the changed operating model did.

## Related decisions

- **Depends on:** [LOC-001 — Operational Location Definition](loc-001-operational-location.md)
- **Depends on:** [TYPE-001 — Location Type Requirement and Ownership](type-001-location-type-requirement.md)

## Evidence

- [FIKA Business Knowledge Workbook](https://docs.google.com/spreadsheets/d/195jMni3vG5fX5hfAUFARc-vC2ifO8AI8r0r4xQUeoxk/edit) — **Canonical**; DEC-TYPE-003, sourced from `Questions!48`.
- [docs/business-workshops/location-type-catalogue.md](../business-workshops/location-type-catalogue.md) — **Historical**; `Type model questions`.
- [Platform principles](../platform-principles.md) — **Canonical**; business meaning, authority, configuration and gradual-migration principles.
- [Business-discovery process](../platform-methodology/business-discovery-process.md) — **Canonical methodology**; approval, exact wording, dependency and history rules.

## Supersedes / Superseded by

- **Supersedes:** None
- **Superseded by:** None

## Future considerations

- Stage 5 should define current-Type access and immutable historical assignments without prematurely selecting storage.

- Future governance must define approval evidence for Type and material OPCAP changes.

- History may be optimised or archived later only if genuinely necessary and without losing business traceability.
