# Canonical Foundation and Events Readiness

## Result

**Not ready** for Events consumption as at 2026-07-28.

The Integration Hub now has a safe published-only repository boundary, but no existing record has been explicitly reviewed into the `published` lifecycle. This is intentional: staging approval is not publication.

## Verified current baseline

- 307 canonical candidates: 176 Legends, 18 provider-derived Site candidates and 113 Product Categories.
- 307 approved staging proposals in two bounded generation documents.
- 0 explicitly published records.
- 96 Legends have exact-name rota evidence; 74 have no exact rota match and 6 are ambiguous.
- 15 Legends have evidence at more than one rota Site label.
- 17 distinct rota Site labels require durable mapping decisions.
- Duplicate review signals: 3 normalised-name groups and 1 work-email group.
- Deferred Till Item and Till Item Variation data remains outside the active Registry and preserved in protected local snapshots and the verified emulator export.

## Recovery evidence

The complete emulator was exported to a Git-ignored recovery folder. An isolated clean emulator on different ports restored the export and reproduced all three source collections with identical document counts and SHA-256 content hashes:

- `integrationHub`: 1 document.
- `integrationHubCanonical`: 307 documents.
- `integrationHubStaging`: 2 documents.

The aggregate restored hash was `260158bad868c5bd5478df947e4153ac57b5c3b7ef70c3f2c98054bf5ae06253`.

## Source completeness findings

BrightHR currently supplies and the mapper retains stable employee identity, name, work email, employment state, job title and termination evidence. The current staging set contains job titles for 172 of 176 Legends and termination dates for 79. No BrightHR work-location reference is present in the current normalised set.

The current mapper does not prove whether employment start date, contract hours, personal contact details, emergency contacts, HR documents or other useful identifiers are supplied because historic syncs retained only minimised provider references in staging. Future BrightHR syncs now write immutable, local, Git-ignored source snapshots before transformation. Restricted fields are classified centrally and are not added to ordinary Legend records.

Rota evidence preserves original Site labels, observed counts and dates. Future dates are explicitly classified as `future-scheduled`; they are not treated as completed work or as confirmed Site Assignments.

## Core contracts

Deliberate development contracts now exist for Employment, Site Assignment, Source Mapping and Operational Placement Evidence alongside the existing family. They represent independent lifecycle, authority or relationship boundaries. No records were silently migrated into them.

Two upstream governance conflicts prevent adoption:

1. The canonical Domain Dictionary still marks Legend as a Future Candidate.
2. Accepted Canon defines Site as an OPLOC Location Type, while the current application and provider import use a separate Site aggregate. Provider-derived Site candidates cannot be published until this is resolved. No OPLOC identity is inferred from Square or rota labels.

## Governance controls

- Lifecycle is `draft`, `needs-review`, `published` or `archived`.
- Existing lifecycle-less records resolve to `needs-review`, never `published`.
- Only explicitly published records are returned from `/api/canonical`.
- Corrections require a reason and retain previous/new values, actor and timestamp.
- Corrected fields may be locked; later provider refresh preserves locked values while retaining the new provider fact as evidence.
- Source mappings are stable, audited and reused on later BrightHR/rota processing.
- Stable issue identities prevent repeated scans from multiplying the same issue.
- Central role-based redaction protects employment, absence, contact and administrator evidence.

## Remaining readiness work

- Resolve Legend canonical ownership and boundary through business governance.
- Resolve Site versus OPLOC meaning; then map source Site labels to stable IDs through review.
- Review ambiguous Legend identities and duplicate candidates.
- Decide and perform explicit publication reviews; no bulk publication is justified by current manifests.
- Confirm BrightHR source-field availability from a new immutable snapshot without exposing private payloads.
- Validate absence redaction against real local absence evidence when such records exist.

Events must consume `/api/canonical` or an equivalent published-only repository interface. It must not read staging, raw provider snapshots or Integration Hub collections directly.
