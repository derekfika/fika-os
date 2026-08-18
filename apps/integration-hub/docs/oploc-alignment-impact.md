# OPLOC Alignment Impact Review

## Authority

This review follows Accepted Pack 1 decisions LOC-001–LOC-006 and TYPE-001–TYPE-003. OPLOC is the durable location identity. Site and Venue are the two currently required primary Location Types. Neither is a separate canonical identity.

## Stored baseline

Before implementation, the live emulator contained 307 canonical candidates: 176 Legend candidates, 18 provider-derived records typed as Site and 113 Product Categories. All remain `needs-review`; none is published. The baseline aggregate hash was `260158bad868c5bd5478df947e4153ac57b5c3b7ef70c3f2c98054bf5ae06253`.

The 18 Site records are a stored-data mismatch, not proof of 18 accepted OPLOCs. Their IDs and evidence must remain intact until an explicit, reversible compatibility decision is made.

## Main conflicts

- `Site` was registered as a canonical entity alongside OPLOC.
- Square locations are transformed into Site candidates.
- OPLOC lacked mandatory primary Location Type and effective-dated history.
- Site Assignment required `siteId`.
- Registry and reconciliation language treated Site and OPLOC as peer identities.
- Publication was lifecycle-controlled but not fully constrained by entity-definition status.

No parent/child OPLOC field or hierarchy is present. Accepted Event contracts already use `operationalLocationId`.

## Safe alignment

- Keep the existing Site validator solely for legacy compatibility.
- Prevent Site, Legend and other unaccepted definitions from publication.
- Use OPLOC for every new canonical location candidate.
- Require `Site` or `Venue` as the current primary Location Type.
- Retain effective-dated Type history so a Venue can become a Site without changing OPLOC identity.
- Make location source mappings point to `oplocId`.
- Preserve original provider and rota labels as evidence.
- Remove `siteId` from the unaccepted Site Assignment development contract without accepting that contract.

## Deferred governance

Legend remains a Future Candidate. OPCAP is described as canonical in the Domain Dictionary, while CAP-001 metadata remains Draft; no capability catalogue is implemented here. Historical pre-Pack booking drafts using `siteId` remain supporting evidence pending a separately governed schema revision.

The machine-readable register is [oploc-alignment-impact.json](oploc-alignment-impact.json).
