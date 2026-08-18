# Legend Canonical Identity Proposal

**Status:** Decision approved 2026-07-28 — governed BDR identifier and workbook registration pending
**Decision ID:** TODO — allocate through the governed decision process
**Domain:** Workforce
**Decision Owner:** Derek approved the definition; TODO — register the accountable role-based business owner
**Repository effect:** Legend is Accepted Canon at definition level. Existing candidates remain unpublished and retain their record-level review state.

## Question

Should Legend represent one durable human identity recognised by FIKA OS, independently of employment, rota and external-provider records?

## Evidence

The local Integration Hub contains 176 unpublished Legend candidates sourced from BrightHR. The reviewed rota comparison found 96 exact name matches, 74 people without an exact rota match and 6 ambiguous names. Current quality analysis identifies three duplicate normalised-name groups, one duplicate work-email group and 15 candidates with evidence at more than one source location label. These observations are candidate evidence, not identity approval.

## Proposed boundary

A Legend would own only durable FIKA-recognised person identity and approved operational contact facts. Employment, absence, emergency contact, training, qualification, operational placement or assignment, performance information and provider-specific HR records would remain separate records with their own authority and access rules.

Multiple provider identities could reference one reviewed Legend without replacing the Legend ID. Exact names, similar names, shared email values and rota frequency would remain evidence only and would never merge identities automatically.

## Authority and privacy questions

- TODO: Confirm the business owner of the Legend definition and identity decisions.
- TODO: Confirm authoritative sources for official name, preferred name, work email, employment state and job title.
- TODO: Classify fields as operationally visible, administratively restricted, HR restricted or never exposed downstream.
- TODO: Decide candidate, reviewed, published and archived lifecycle meaning.
- TODO: Decide whether a preferred name is part of core identity or a separately governed attribute.

## Relationships requiring a decision

Employment, Absence, Operational Placement Evidence, future operational assignment records and External Identities would reference a durable Legend only if this proposal is accepted. None of those records would be embedded into the Legend aggregate.

## Credible alternatives

1. Retain provider-scoped person identities and do not create a durable FIKA identity.
2. Adopt a durable person identity with a different canonical name or narrower boundary.
3. Defer the decision while retaining the 176 candidates and their provider links unpublished.

## Approved decision

On 2026-07-28 Derek accepted `Legend` as the durable canonical identity of a human recognised by FIKA OS. This accepts the entity definition only. It does not approve, merge or publish any candidate, approve provider-derived fields or expose restricted HR information.

The earlier Future Candidate state and credible alternatives remain preserved above as decision history. Existing IDs and provider evidence remain unchanged. Employment, Absence, emergency contacts, training, qualifications, Operational Assignments, performance information, provider-specific HR records and restricted HR evidence remain separate.

## Remaining governance administration

- TODO: Allocate the governed BDR identifier through the established decision register.
- TODO: Register the accountable role-based business owner.
- TODO: Complete the field-authority and privacy decisions without delaying the accepted core identity boundary.
