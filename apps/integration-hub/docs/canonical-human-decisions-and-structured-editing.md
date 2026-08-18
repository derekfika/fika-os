# Canonical Human Decisions and Structured Record Editing

## Status

Implemented locally on 2026-07-28. No cloud connection, deployment, production write, working-emulator canonical mutation, record approval or publication occurred.

## Verified starting position

- `integrationHub`: 1 document
- `integrationHubCanonical`: 307 documents
- `integrationHubStaging`: 2 documents
- Aggregate integrity hash: `260158bad868c5bd5478df947e4153ac57b5c3b7ef70c3f2c98054bf5ae06253`
- Preserved legacy Site candidates: 18
- Unpublished Legend candidates: 176
- Published records: 0

The pre-change recovery checkpoint is held outside Git at `local-data/integration-hub/recovery/canonical-editing-prechange-2026-07-28`. Its isolated restoration was verified before and after mutation tests with the same counts and aggregate hash.

## Architecture extended

Provider evidence remains in staging and provider-owned evidence. Canonical records remain per-document records in `integrationHubCanonical`. The new structured editor calls a server route, which enforces AuthMod, loads the current version, validates the complete proposed record, verifies locks and relationships, computes an exact diff, and uses one short Firestore transaction to write:

- the candidate record;
- a complete revision in `integrationHubCanonicalRevisions`;
- an exact governed audit event in `integrationHubGovernanceAudit`; and
- a deterministic legacy-source mapping where explicitly selected.

The browser never writes directly to Firestore and never supplies the actor identity. Governed candidate saves normally result in `needs-review`. Under amended ADDR-001, a valid Address supplied by an authorised user is the deliberate exception: it is approved and published automatically with actor, revision and audit evidence.

## Governance outcome

- OPLOC remains Accepted Canon.
- Legend is Accepted Canon at definition level. The earlier Future Candidate state remains in definition history.
- Operational Assignment is Accepted Canon at definition level. The earlier discovery proposal and the development-only Site Assignment boundary remain preserved.
- CAP-001 through CAP-004 are Accepted. Operational Capability and Capability Enablement are separate accepted definitions.
- Site and Venue remain Location Types, not canonical location entities.
- The 18 Site records remain legacy source candidates and were not modified.
- Existing Legend candidates retain their existing review states and remain unpublished.
- Product Category and Operational Placement Evidence retain their previous statuses.
- No new BDR identifier was invented for Legend or Operational Assignment; governed identifier registration remains TODO.

On Derek's clarification, all 54 completed Pack 1–8 BDRs now show `Accepted`. The earlier Draft metadata labels were corrected with status-history notes. A mechanical comparison confirmed that all 54 Decision sections remain character-for-character unchanged.

## AuthMod

The existing local roles remain the only role model:

- `integration-admin` represents the locally authorised project-owner/Operations boundary and holds create, edit, approval, lifecycle, publication and lock permissions.
- `reviewer` may view, prepare and preview changes but cannot approve, publish or lock governed records.
- `viewer` may view only.

Server enforcement uses explicit permissions. There are no email-address, person-name or display-label checks in the canonical routes. The existing synthetic local authentication remains development-only.

## Structured editor

Supported candidate definitions:

- OPLOC
- Address
- Legend
- Operational Assignment
- Operational Capability
- Capability Enablement

The central form definition uses text, email, text area, governed select, date, repeatable text and searchable stable-ID relationship controls. Immutable IDs and protected metadata are not editable. Field locks disable inputs and are rechecked on the server. Correctable validation errors and stale-edit conflicts leave the unsaved form state in place.

Legend exposes only approved name, preferred name and work email. Employment state, job title, absence, emergency-contact and restricted HR evidence are not editable Legend fields. Compatibility fields on the 176 existing provider-derived candidates are retained without transformation and explicitly block publication until separated into their correct domain.

Operational Assignment references `legendId` and `oplocId`, supports open assignment-role wording, primary/secondary designation and effective dates, and cannot be created by rota frequency or provider refresh.

Operational Capability catalogue records use the established `cap:` identity convention. Capability Enablement separately relates an accepted capability to an OPLOC, is effective-dated, records its accountable role and availability state, and does not change Location Type or grant permission.

## OPLOC address boundary

Structured address fields are not embedded into OPLOC. Accepted LOC-003 states that OPLOC does not own address master data, and OPLOC stores only `addressReference`. Amended ADDR-001 provides a searchable reusable Address selector and inline structured creation. A valid inline Address is normalised, duplicate-checked, automatically approved and published, and linked to the OPLOC in one transaction; the OPLOC itself remains unpublished until its ordinary lifecycle decision.

## Legacy Site decisions

Quality & Reconciliation now lists all 18 preserved Site candidates. An authorised user may preview and then:

- create an unpublished OPLOC candidate with an explicit permanent `oploc:` ID;
- map the evidence to an existing OPLOC;
- reject it as a canonical location;
- defer it; or
- leave it unresolved.

The source record remains unchanged. Confirmed mappings use `oplocId`, are deterministic and reject replacement of an existing confirmed mapping without separate review. Similarity never creates an identity.

## Lifecycle and publication

Definition acceptance, schema validity, record review, publication eligibility and publication remain distinct. Publication assessment now reports blockers for unaccepted definitions, schema failures, wrong lifecycle, missing human-decision provenance, legacy Employment fields, missing references and unpublished references.

The first OPLOC pilot is a readiness preview only. It displays name, lifecycle, address reference, aliases, source mappings and exact blockers. It performs no final publication.

## API boundary

`/api/canonical` now accepts OPLOC, Legend, Operational Assignment, Operational Capability and Capability Enablement queries. It defaults to OPLOC for backward compatibility and provides deterministic ID ordering, pagination, role-based redaction and broken-reference detection. Only explicitly published Accepted Canon records cross the boundary. Site and Venue are never exposed as entity collections.

## Events readiness

**Not ready.**

The downstream contract is now capable of supplying published OPLOCs and safe accepted definitions, but the working registry contains no OPLOC candidates and no published records. Events must not consume legacy Site identities or raw provider labels. Events remains unchanged and should integrate only after at least one separately reviewed and published OPLOC is available through `/api/canonical`.

Legend and Operational Assignment access also requires a purpose-specific permission and privacy decision before Events should consume them. The current API redaction remains deliberately conservative.

## Validation

- Unit tests: 46 passed
- Isolated transaction verification: 5 synthetic candidates, 5 revisions and 5 audit events; stale write and broken relationship rejected; no publication
- Isolated restore after mutation verification: exact baseline counts and hash restored
- TypeScript: passed
- Lint: passed
- Production build: passed with one pre-existing Turbopack file-tracing warning from the local upload/repository filesystem path
- Browser checks: structured OPLOC, Legend and Operational Assignment controls; accepted catalogue statuses; 18 legacy decision rows; preview/cancel boundary; viewer edit controls absent; no console warning or error
- Working emulator after implementation: exact baseline counts and aggregate hash unchanged

## Remaining decisions and limitations

- Register governed BDR identifiers and accountable role-based owners for Legend and Operational Assignment without inventing IDs.
- Adopt a separate structured Address contract before adding structured address inputs.
- Populate and approve individual Operational Capability catalogue records before creating real enablements.
- Review records individually; definition acceptance did not approve any existing record.
- Select the first OPLOC pilot candidate and complete its real human review in a later authorised operational session.
- No bulk merge or identity-resolution workflow was introduced for ambiguous Legends.
