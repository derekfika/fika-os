# OPLOC Alignment and Canonical Decision Readiness

## Verdict

**Not ready for an OPLOC publication pilot.** The accepted model is now enforced at the application boundaries, but the working emulator contains no OPLOC candidates. The 18 provider-derived `Site` candidates have unsafe `site:` IDs and therefore remain preserved as legacy evidence until each proposed OPLOC identity and Location Type is explicitly reviewed.

## Verified baseline and recovery

Before change, the working local emulator contained 307 canonical candidates: 176 Legend, 18 provider-derived Site and 113 Product Category records. It contained two staging records and no published records. The aggregate integrity hash was `260158bad868c5bd5478df947e4153ac57b5c3b7ef70c3f2c98054bf5ae06253`.

The baseline matched the previously established inventory. A new checkpoint was created at `local-data/integration-hub/recovery/oploc-alignment-prechange-2026-07-28` by copying the already verified export only after the live aggregate hash matched. Its isolated restore reproduced the same collection counts and hashes. Sensitive recovery data remains outside Git.

## Accepted location model enforced

- OPLOC is the sole durable canonical location identity.
- Site and Venue are the only currently supported Location Type values.
- Site and Venue cannot be published as separate entity types.
- An OPLOC keeps its ID through an effective-dated Venue-to-Site change.
- Exactly one current Location Type assignment must match the OPLOC primary Location Type.
- Operational functions such as Coffee Bar, Restaurant, Pantry, Production Kitchen, CPU and Hospitality are rejected as Location Types.
- The OPLOC schema is strict, so `parentOplocId` and other invented hierarchy fields are rejected.
- Source mappings for locations require `oplocId` and may reference an existing OPLOC only.
- Operational Placement Evidence uses the original `sourceLocationLabel`, an optional reviewed `oplocId`, and a distinct historical, current, future-scheduled or unresolved evidence period.
- The existing Site Assignment contract remains development-only and now references `oplocId`; its business meaning remains unresolved.

## Provider-derived candidate alignment

The explicit `npm run migration:oploc-readiness` process is dry-run only, independent of application startup, idempotent and non-destructive. It produced:

- source candidates: 18;
- existing OPLOCs: 0;
- compatibility proposals: 18;
- writes: 0;
- safely preserved IDs: 0;
- IDs requiring explicit mapping: 18;
- source aggregate hash: `d14c43f2aee8ef298763e0e9eaee9cbf1835f7180a16c45e15e603aec2b81093`;
- proposed-target aggregate hash: `8251c2c5cd642068a72b9c6075624ac64f17b3f9a2d14a995047009e1f9e63b2`.

Each proposal retains the original canonical candidate ID, provider identity, provider label, complete source-record hash, proposed OPLOC ID, proposed Site classification, classification basis and possible duplicate evidence. No proposal approves identity or classification. Because all 18 IDs encode the rejected Site entity type, execution stops before any identity change, as required.

## Definition and publication readiness

The Schema Catalogue now distinguishes `accepted-canon`, `future-candidate`, `development-only`, `legacy-source-candidate` and `deferred` definitions. Only OPLOC is currently registered as Accepted Canon for publication. Legend is Future Candidate; Site is legacy source evidence; the assignment, placement, mapping and Product Category contracts are development-only; Till contracts remain deferred.

The server publication gate checks definition status, schema validity, lifecycle and broken references. A valid record belonging to an unaccepted definition remains ineligible. Existing records stay unpublished. No publication was attempted.

The controlled pilot currently has zero objectively eligible candidates. The final human confirmation boundary therefore cannot yet be reached. The next governed action is record-by-record review of proposed OPLOC IDs, approved names and Site/Venue classifications—not bulk migration.

## Legend readiness

Legend remains a Future Candidate and all 176 records remain unpublished. A formal proposal has been prepared at `fika-platform-specs/docs/business-decisions/proposals/legend-canonical-identity-proposal.md`. It records evidence, boundaries, authority and privacy questions, lifecycle questions, relationships and credible alternatives without inventing a Decision ID or accepting the concept.

The Quality & Reconciliation workspace describes these as candidate-person reviews. It supports audited confirmation or rejection of source identity links without destructive merge or publication. Preferred-name authority remains a business decision and is not conflated with identity linking.

## Downstream boundary

`GET /api/canonical` now exposes published Accepted Canon OPLOC records only. It validates `entityType=OPLOC`, optional `locationType=Site|Venue`, `limit` from 1 to 200 and an `after` cursor. Results are ordered by stable canonical ID and centrally redacted. Site, Venue, Legend and development definitions are rejected or excluded; no raw provider payload is returned.

The query currently performs Location Type filtering and cursor pagination after reading the published set. This is correct for the zero-record pilot and deterministic in tests, but should move to indexed server-side paging before material scale.

## Events readiness

**Not ready.** The intended boundary is now clear and tested: Events should store only a published stable `oplocId`, and may filter OPLOC choices by Location Type. It must not store provider labels as foreign keys or create competing Site/Venue identities. However, there are no reviewed or published OPLOC records for Events to consume. Events itself was not modified.

## Governed decisions still required

1. Explicit review of each proposed OPLOC identity, approved name and primary Location Type; the 18 proposed IDs are not approved automatically.
2. Business ownership and authority for record-level OPLOC review and Location Type transitions where current application roles cannot prove the governed organisational role.
3. Acceptance, revision, deferral or rejection of the Legend proposal, including field authority and privacy classifications.
4. The future operational-assignment boundary recorded in `fika-platform-specs/docs/domain-discovery/operational-assignment-proposal.md`.
5. Reconciliation of the Domain Dictionary description of OPCAP with CAP-001 metadata before any capability catalogue is implemented.

## Safe next stage

Run an authorised, record-by-record OPLOC candidate decision session using the dry-run mapping plan. Add a reviewed candidate-creation command only after the proposed immutable IDs and reviewer authority are approved. Then prepare exactly one OPLOC for the controlled publication preview and stop at its final confirmation.
