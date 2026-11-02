# Hospitality booking readiness scorecards — 2 November 2026

**Scope:** Munich RE first, then CFC. This is a source/evidence status report, not customer UAT. No booking portal or customer-shared URL was opened. No staging writes, catalogue edits, booking mutations, messages, or production actions were performed.

**Source baseline:** origin/main 410e1f827213d09ed58be9c43e4fed1677921de0.

**Staging evidence:** the coordinator’s governed read-only Hospitality staging preview at 17:34Z on 2 November reported fika-hospitality-staging in project fika-os-dev, source dc77dce5f5b6d69ee00d74a511ba51fcc16cc3b0, rollout/build build-2026-11-01-001, SUCCEEDED, 100% traffic. URL: [Hospitality staging](https://fika-hospitality-staging--fika-os-dev.europe-west4.hosted.app). This is the staging app URL, not proof that the customer-shared MR or CFC link resolves there.

## Decision

| Site | Status | Reason |
|---|---|---|
| Munich RE | **NOT READY — acceptance evidence incomplete** | The customer-shared URL/environment, current public-site binding, actual item/catalogue reconciliation, and write-path/downstream acceptance are not verified. |
| CFC | **NOT READY — acceptance evidence incomplete** | The current share URL/environment, public-site binding, provider/brochure reconciliation, and write-path/downstream acceptance are not verified. |

PR #224 addresses service/category visibility in consumer code. It does not populate catalogue Items, provider-location mappings, room/location data, or prove customer-site readiness. Do not infer readiness from that PR’s merge or CI status.

## Munich RE — NOT READY

| Readiness check | Status | Evidence / remaining proof |
|---|---|---|
| Customer-shared URL and serving environment | **UNVERIFIED** | Owner says the MR link was already shared with clients. The issue record does not establish its actual URL/environment or the serving build for that link. Verify through a safe, non-writing method before navigation; do not assume it is staging. [Owner update](https://github.com/derekfika/fika-os/issues/119#issuecomment-6557620234) |
| Public site → canonical OPLOC/provider-location binding | **UNVERIFIED / BLOCKED** | 1 Nov UAT reported the munich-re public catalogue binding failing. PR #224’s code requires a unique confirmed Hub provider-location mapping and fails closed if absent/ambiguous, but does not create or verify the mapping data. [Owner update](https://github.com/derekfika/fika-os/issues/265#issuecomment-6583750889) · [PR #224](https://github.com/derekfika/fika-os/pull/224) |
| Published services and category visibility | **CODE CHANGE NOT INTEGRATED** | PR #224 contains the CFC/MR consumers and Hub acceptance checks. It is open at head cce22f2210cee177b372148988e16b8dddd3288a, based on 7164b04a66be031e62d8b10ec7bd8c458aa8d7f0; current main is 410e1f827213d09ed58be9c43e4fed1677921de0. Its recorded validation run #416 succeeded on that older head; the PR is behind current main and has no formal review recorded. It has not been staged. Refresh scope, source, CI, and review through a supported process before integration. |
| Canonical Items matched to authoritative MR booking form | **UNVERIFIED** | The existing MR booking form is the source of truth. No row-level matched/missing/ambiguous reconciliation is attached to the reviewed evidence. Do not use brochure assumptions or invent Item/recipe links. [#119 owner update](https://github.com/derekfika/fika-os/issues/265#issuecomment-6583750889) |
| Prices, VAT, minimums, pack/quantity rules, availability, production routing | **UNVERIFIED** | Reconcile the current form and authoritative Hub records row by row. Exact values are not established in the evidence reviewed. |
| Room / collection-point choices | **OWNER SAYS OPTION LIST COMPLETE; RULES UNVERIFIED** | The owner said the MR option list is complete and instructed not to invent more options. Operational restrictions/availability and styling acceptance still need confirmation; the owner identified Damjan as the decision dependency. [Location clarification](https://github.com/derekfika/fika-os/issues/119#issuecomment-6548944160) |
| Create → amend → cancel, Hub/CPU/Logistics routing, exactly-once behavior | **NOT TESTED; WRITE-PATH BLOCKED** | #181 staging isolation is not verified. No synthetic booking writes or downstream propagation checks were run. No real customer booking or outbound effects are authorized by this report. |

## CFC — NOT READY

| Readiness check | Status | Evidence / remaining proof |
|---|---|---|
| Current shared URL and serving environment | **UNVERIFIED** | Owner said the CFC link would be shared that week; the reviewed record does not establish the actual current link or its environment. Verify the exact link/build safely before navigation. [Owner update](https://github.com/derekfika/fika-os/issues/119#issuecomment-6557620234) |
| Public site → canonical OPLOC/provider-location binding | **UNVERIFIED / BLOCKED** | 1 Nov UAT reported the cfc public catalogue binding failing. PR #224 requires a unique confirmed provider-location mapping but does not populate or verify the operational mapping. [Owner update](https://github.com/derekfika/fika-os/issues/265#issuecomment-6583750889) · [PR #224](https://github.com/derekfika/fika-os/pull/224) |
| Published services and category visibility | **CODE CHANGE NOT INTEGRATED** | Same PR #224 status as above; it has not been staged or accepted by site UAT. |
| Provider/brochure rows matched to canonical Items | **UNVERIFIED** | Reconcile the authorised CFC provider/brochure against active Hub Items, aliases, price, quantity rules, routing, and actual site settings. No row-level matched/missing/ambiguous result is present in the evidence reviewed. Do not create duplicate Items or mappings by guesswork. [#119 consolidated scope](https://github.com/derekfika/fika-os/issues/119) |
| Prices, VAT, minimums, pack sizes, availability, production routing | **UNVERIFIED** | Values need to be reconciled to authoritative provider/catalogue data and actual site configuration; no values are inferred here. |
| Floor, room/delivery point, or collection choices | **UNVERIFIED / REVALIDATE REQUIREMENT** | Historical acceptance says CFC had an owner-approved single required Location dropdown with an 18-room directory, but implementation had not started at that checkpoint. The owner later clarified that MR/CFC use a selected room or collection point, while separate Floor plus Room/Delivery Point fields apply to RCoA/OAC. Reconfirm the CFC directory source and verify implementation and round-trip behavior before declaring readiness. [Prior status table](https://github.com/derekfika/fika-os/issues/119#issuecomment-6549675076) · [Owner clarification](https://github.com/derekfika/fika-os/issues/119#issuecomment-6548944160) |
| Create → amend → cancel, Hub/CPU/Logistics routing, exactly-once behavior | **NOT TESTED; WRITE-PATH BLOCKED** | #181 staging isolation is not verified. No synthetic booking writes or downstream propagation checks were run. |

## Shared constraints and next proof

- **Do not navigate the booking forms in the current browser context.** Prior review found RCoA page mount can restore and serialize an unfinished draft to browser localStorage; that is not evidence of a Hub booking write, but it makes an unisolated browser visit an unintended local persistence side effect. [Review correction](https://github.com/derekfika/fika-os/issues/119#issuecomment-6554776477)
- **#224 integration is held.** Its active lease is issue-175-cfc-mr-visibility; three Hub paths in its diff exceed the recorded scope. No in-place scope amendment is available in the current canonical CLI. Do not force-merge, widen the lease manually, or reimplement concurrently.
- **#181 remains a write-path gate** until effective staging isolation, sink configuration, and the relevant runtime identity are verified. Read-only serving metadata does not prove isolation.
- For each site, first capture the actual shared URL and exact serving build without opening a stateful form. Then obtain authoritative source rows and produce matched / missing / ambiguous / blocked reconciliation. Only after isolation and safe synthetic-data authorization are confirmed should write-path and downstream CPU/Logistics tests be planned.
- Keep both site scorecards **NOT READY** until their site-specific mapping, catalogue reconciliation, location/options, and required acceptance evidence are established.

## Evidence boundaries

This report is based on current main identity, PR #224 metadata and its recorded workflow run, owner/user evidence in #119 and #265, and the coordinator’s governed staging dry-run. It does not inspect production or customer records, open a booking URL, prove that public forms are currently functioning, or claim successful UAT.
