# Stage 7 First-Increment Selection Review

**Review date:** 2026-07-27

**Decision:** No Selection

**Stage 7 status:** Planned

**Stage 8 status:** Planned

**Implementation status:** Not started

## Purpose

This record compares credible first implementation increments after Stage 6 closure. It identifies the smallest remaining governance decision without turning historical priorities, technical readiness or an AI recommendation into business authority.

No Increment 1 charter is created because no increment has been selected. This record is the smallest durable location consistent with the existing canonical stage-document structure; it creates no separate project-management taxonomy.

## Authority and baseline

The live repository and Git history were reviewed. The governed baseline is:

- Stages 1–6 are complete; Stage 6 closed on 2026-07-27 in commit `468222f`.
- The Stage 6 architecture sequence is present in commits `e1b67df`, `d82ea2f`, `967787a`, `4f4459d`, `a1f3420`, `837bd73`, `70df5be` and `aaaeff3`.
- No later commit or repository record selects Increment 1 or activates Stage 7.
- BDRs own approved business meaning, adopted schemas implement it, and ADRs govern architecture without redefining either.
- Existing operational systems remain in force. This review authorises no application change, production write, provider change, migration, cutover, release or retirement.

Repository evidence can compare readiness, but it does not determine which operational pain matters most now, who accepts the outcome, who supports it, or the acceptable failure and fallback boundary. Those are business and operational choices.

## Rating vocabulary

- **Strong:** direct, current evidence supports the criterion and no central earlier-stage gap is known.
- **Moderate:** useful evidence exists, but a bounded prerequisite or material unknown remains.
- **Weak:** the central outcome or authority depends on unresolved earlier-stage meaning or ownership.
- **Low complexity/disruption:** few sensitive or live boundaries are implicated.
- **Medium complexity/disruption:** bounded controls or coexistence work is required.
- **High complexity/disruption:** critical live workflow, sensitive data or broad cross-domain effects are implicated.
- **Unknown:** the repository does not contain reliable evidence.

These labels compare evidence quality and delivery conditions; they are not business-priority ratings.

## Current operational evidence

| Area | Current evidence | Users/owner | Authority and execution | Pain, recovery and freshness |
|---|---|---|---|---|
| Hospitality Booking | MNK and Angel Court are Live; MNK is the preferred direct baseline; Angel Court retains email intake as a fallback. | Users, accountable owner, support owner and criticality are `TODO`. | Booking Platform is authoritative for direct bookings; dashboards and Sheets are operational consumers/projections. | Duplicate-ID scans, broad locks and multi-Sheet partial state are confirmed patterns; impact and recovery ownership are unmeasured. July 2026 evidence. |
| Hospitality Dashboards | Five variants exist; Angel Court and MNK support substantial operational workflows. | Lifecycle is unconfirmed for several variants; users and owners are `TODO`. | Dashboards initiate workflows and consume Booking state; they must not become canonical by presentation. | Full-range reads, broad scans and Drive-name lookup are suspected risks without current timings. July 2026 evidence. |
| CPU Production | A substantive Calendar-led dashboard ingests attached JSON/documents and writes CPU Orders and Deliveries projections. | Current users, lifecycle, accountable owner, support owner and criticality are `TODO`. | Production owns fulfilment; Calendar/Sheets/dashboard remain a legacy system of execution and operational projections. | Partial processing, cancellation propagation and name-based aggregation risks are documented; volumes and recovery authority are unknown. Audited 2026-07-11. |
| Events | Company-wide Events Dashboard and separate public experiences are Planned; no local implementation repository is recorded. | Event approval roles exist in BDRs; first users, product owner, operational owner and support owner are not confirmed. | Pack 5 provides an adopted Event contract. No current Event system of record or execution is confirmed. | Low legacy displacement is plausible, but channels, pain, recovery and acceptance evidence are incomplete. |
| Waste | Waste is governed and Pack 8 contains Waste Event and Waste Disposition contracts. | Operations owns the domain; individual locations record waste. Named first users, accountable scope owner and support owner are not confirmed. | No current authoritative operational system or implementation repository is recorded. | Measurement Catalogue values are deferred; current volumes, workflows and fallback are unknown. |
| Improvement/error/suggestion reporting | Feedback utilities exist, but Improvement Action meaning is explicitly deferred. | Product/support ownership and users for error or suggestion intake are unconfirmed. | Error telemetry, feedback, suggestions and Improvement Actions are distinct; no authority exists for a combined record. | Central meaning, lifecycle and acceptance are unresolved. |
| Reference data | Adopted Client, Operational Location, Role, AUTHMOD, Capability and Configuration contracts exist. | Catalogue/domain ownership is governed; first operational consumer and support owner are unconfirmed. | A future owning-domain repository could provide an authoritative query. No implementation source is selected. | Low live disruption is plausible, but no evidenced current user outcome proves which catalogue should be first. |
| Shared technical capabilities | ADRs define repositories, projections, identity/AUTHMOD, events, coexistence and notifications. | Business consumer and independent operational owner vary by use case. | These are implementation boundaries, not standalone business outcomes. | Building one first risks speculative horizontal infrastructure without an independently usable result. |

Unknown values remain unknown. Historical Stage 1 priorities inform candidate discovery but are not current commitments.

## Candidate definitions and dependency test

### A — Direct Booking intake to a governed consumer boundary

For Angel Court or MNK hospitality operators, accept one direct submission and expose its attributable booking object to an authorised consumer without recreating it from email or a booking-form Sheet.

- **Authority direction:** Booking Platform to Booking-owned record or governed consumer/projection.
- **Minimum contracts:** Booking BDRs, Pack 4 components, ADR-005/006/007/010 and applicable AUTHMOD contracts.
- **Legacy:** Angel Court email intake remains an adapter and fallback.
- **Why viable:** real live workflow and strong operational evidence.
- **Why not currently selectable:** an authoritative end-to-end write requires the missing Booking aggregate and schema-versioning convention; owner, acceptance and support authority are unconfirmed.
- **Earliest return:** bounded Stage 5 Booking aggregate reconciliation, preceded by explicit selection authority if this outcome is chosen.
- **Smallest useful release:** one non-production direct-submission contract path for one Operational Location, with no cutover.

### B — Shadow CPU Production intake and operational projection

For CPU production operators, transform one attributable eligible Booking input into Production Order/Line records in an isolated non-production or shadow path and display reconciliation status without changing the Calendar-led workflow.

- **Authority direction:** attributable legacy Booking observation through orchestration to Production-owned records; the CPU path remains operational authority for its declared period unless separately governed.
- **Minimum contracts:** Production BDRs, Pack 6, ADR-005/006/007/008/009/010.
- **Legacy:** Calendar-led ingestion and CPU Sheets remain unchanged; shadow output creates no external effect.
- **Why viable:** adopted Production contracts and strong architectural boundaries; it tests partial, uncertain and reconciliation paths vertically.
- **Why not currently selectable:** target CPU users, accountable Production role, acceptance/support authority, acceptable shadow divergence and implementation repository are unknown. Routing and dietary allocation cannot be invented.
- **Earliest return:** Stage 3/4 only if the selected path requires unresolved Production policy; otherwise Stage 7 prerequisite decisions.
- **Smallest useful release:** one isolated transformation and read-only reconciliation view for one input class, excluding live CPU mutation.

### C — Internal Event register

For an authorised internal Event operations group, record one approved Event and retrieve it in a company-wide internal list with approval attribution.

- **Authority direction:** Event domain owns the Event; providers and channels are adapters.
- **Minimum contracts:** EVT-001/002, Pack 5 Event schema, ADR-005/006/007/008/010.
- **Legacy:** no current canonical Event implementation is confirmed; existing channels remain untouched.
- **Why viable:** one adopted aggregate contract, planned company-wide value and potentially low legacy disruption.
- **Why not currently selectable:** first users, accountable product/operational owner, support owner, current channel boundary and business priority are not confirmed. Lifecycle and publication policy must stay outside the slice.
- **Earliest return:** Stage 3/4 only if recording requires unresolved Event policy; otherwise Stage 7 ownership and repository prerequisites.
- **Smallest useful release:** internal creation and read of an already-approved Event only, with no public publication or notifications.

### D — Improvement, error or suggestion intake

For a named internal group, capture one explicitly defined class of operational error or suggestion and make it available to its accountable owner.

- **Authority direction:** unresolved; technical telemetry, feedback, suggestions and canonical Improvement Actions cannot be merged.
- **Minimum contracts:** none sufficient for the proposed combined outcome.
- **Legacy:** existing feedback utilities do not establish canonical Improvement ownership.
- **Why viable:** plausible operational value.
- **Why not currently selectable:** the record, lifecycle, owner, authority and acceptance meaning are not governed.
- **Earliest return:** Stage 2/3 discovery and Stage 4 BDR before schema or implementation.
- **Smallest useful release:** cannot be stated without inventing business meaning; deferred.

### E — Waste Event capture

For authorised Operational Location Legends, record a Waste Event and immediate Waste Disposition for Operations reporting.

- **Authority direction:** Waste owns the occurrence and disposition; reporting consumes them.
- **Minimum contracts:** WASTE-001, Pack 8 Waste schemas, Pack 1 Operational Location, AUTHMOD and ADR-005/006/007/008.
- **Legacy:** no current authoritative Waste workflow is confirmed.
- **Why viable:** bounded outcome with adopted component contracts and explicit Operations ownership.
- **Why not currently selectable:** Measurement Catalogue values are deferred, as are first user scope, accountable role, acceptance/support authority, fallback and implementation repository. Quantity units cannot be invented.
- **Earliest return:** Stage 3/4 and Stage 5 for the minimum governed Measurement Catalogue dependency if capture is selected.
- **Smallest useful release:** one Operational Location records one event and disposition using approved catalogue values; currently blocked by those values.

### F — Existing-dashboard freshness and reconciliation view

For hospitality or CPU operators, show the source, `as of` time, completeness and reconciliation state of one existing operational projection without permitting canonical mutation.

- **Authority direction:** owning domain remains authoritative; projection builder alone updates the projection.
- **Minimum contracts:** ADR-005/006/007/010 and the selected domain contracts.
- **Legacy:** existing dashboard and system of execution remain unchanged.
- **Why viable:** bounded, reversible and aligned to confirmed projection ambiguity.
- **Why not currently selectable:** a named dashboard, actual user pain, freshness expectations, owner, support path and acceptance authority are unknown. Without those, it risks becoming a technical showcase.
- **Earliest return:** Stage 7 prerequisite decisions after business selection; Stage 3/4 only if freshness meaning needs new policy.
- **Smallest useful release:** one read-only projection panel for one current view and one authoritative source.

### G — Operational Location reference view

For a named internal operational group, retrieve approved Operational Location identity, lifecycle and permitted Client relationship facts from one governed read path.

- **Authority direction:** Operational Location and Client own their respective facts; the view owns none.
- **Minimum contracts:** Pack 1, relevant LOC/CLIENT BDRs, ADR-006/007/008/010.
- **Legacy:** no source can be displaced or copied into competing truth without a declared migration unit.
- **Why viable:** mature accepted BDRs and adopted schemas; narrow read-only boundary.
- **Why not currently selectable:** no current user, pain, authoritative implementation source, data steward, freshness need or support owner is evidenced. It is not independently valuable merely because it is foundational.
- **Earliest return:** Stage 7 selection and ownership decision; possible Stage 3/4 clarification if source stewardship is insufficient.
- **Smallest useful release:** read-only lookup for one named workflow, once that workflow is identified.

### H — Shared AUTHMOD or repository capability

For a later selected vertical increment, provide only the minimum authority evaluation or persistence behaviour needed by that outcome.

- **Authority direction:** AUTHMOD evaluates authority; owning domains accept or reject business commands. Repositories preserve domain-owned state.
- **Minimum contracts:** Pack 2 and ADR-006/008.
- **Legacy:** depends on the consuming slice.
- **Why viable:** necessary inside future vertical increments.
- **Why not currently selectable:** neither capability is an independently usable operational outcome in current evidence.
- **Earliest return:** Stage 7 as part of a selected vertical slice.
- **Smallest useful release:** not standalone; include only what the chosen vertical path requires.

## Candidate comparison matrix

| Candidate | Outcome/value | User/owner clarity | Business/schema/architecture readiness | Security/data | Legacy/breadth | Reversibility/acceptance | Earlier-stage work | Principal risk | Disposition |
|---|---|---|---|---|---|---|---|---|---|
| A — Direct Booking intake | Strong live value | Weak | Strong / weak aggregate / strong | High | High / medium | Medium | Stage 5 aggregate reconciliation | Using an unadopted aggregate | Defer |
| B — Shadow CPU Production | Strong qualitative value | Weak | Moderate / strong / strong | Medium/high | Low if isolated / medium | Strong; owner unknown | Bounded policy check possible | Silent dual truth | Strongest technical alternative; gated |
| C — Internal Event register | Moderate planned value | Weak | Moderate / strong / strong | Medium | Low / medium | Strong; owner unknown | Possible Event-policy return | Planned importance substituted for current authority | Strong alternative; gated |
| D — Improvement/error intake | Unknown | Weak | Weak / weak / insufficient | Unknown | Unknown | Unknown | Stages 2–5 | Inventing a combined concept | Reject for Increment 1 |
| E — Waste capture | Moderate governed value | Moderate domain; weak increment | Moderate / conditional / strong | Medium | Low / small | Strong; owner unknown | Measurement Catalogue | Hardcoded units | Defer |
| F — Projection freshness | Potential value | Weak | Varies / moderate / strong | View-dependent | Low / small | Strong | Usually Stage 7 | Technical showcase | Gated |
| G — OPLOC reference view | Potential shared value | Weak | Strong / strong / strong | Medium | Medium if source unclear / small | Strong | Stewardship may need confirmation | Competing reference truth | Gated |
| H — Shared capability | Indirect only | Weak as product | Strong contracts | Consumer-dependent | Variable / horizontal | Not operationally acceptable alone | None if embedded | Speculative foundation | Do not select standalone |

## Strongest alternative

The **shadow CPU Production intake and reconciliation path** is the strongest technical alternative because Pack 6 and ADR-009 provide direct contract and orchestration evidence, while an isolated path could preserve Calendar-led operation. It is not selected because the repository cannot name its target operators and accountable roles, prove that this pain is the current business priority, or authorise the acceptable shadow/fallback boundary. Selecting it would be an AI preference.

The internal Event register is close behind because it could use an adopted aggregate with little confirmed legacy displacement. Its current users, operational ownership, channel boundary and priority are even less evidenced.

## Selection decision

**No Selection. Stage 7 remains Planned.**

The activation gate is not satisfied because:

1. business authority has not chosen the operational outcome that matters most now among plausible candidates;
2. no candidate has a complete accountable business/product, technical, operational-acceptance and support ownership set;
3. acceptable failure, fallback and disruption boundaries are not authorised for the strongest live-workflow candidate; and
4. the implementation repository is unselected for every new canonical capability.

Later contract, technology and rollout prerequisites do not all block selection, but the first two items determine which increment should exist and therefore block activation.

## Smallest next governance action

Derek, as business authority, must provide one bounded selection instruction containing:

1. **Outcome priority:** choose the first outcome from B, C, E, F or G, or name another bounded user/outcome. Candidate A may be chosen only with acceptance that Booking aggregate reconciliation becomes an earlier-stage prerequisite. Candidate D requires new discovery.
2. **Accountability:** name the accountable organisational role for business/product acceptance and the accountable organisational role for operational acceptance/support. People may later be assigned through AUTHMOD; authority must not be inferred from job title or technical access.

If the selected outcome touches a live workflow, the instruction must also state whether the first release is isolated/shadow/read-only and confirm that the existing workflow remains the fallback. No production rollout authority is requested or implied.

This is one governance gate because outcome and accountable acceptance are inseparable for selection. Repository, technology, detailed security controls and release authority can be timed after selection.

## Prerequisite applicability before future activation

| Prerequisite | Applicability/status | Required timing | Owner/route | Activation blocker? |
|---|---|---|---|---|
| Bounded outcome selection | All; missing | Before activation | Derek through governed selection | Yes |
| Business/product owner | All; missing for increment | Before activation | Organisational role decision and Assignment | Yes |
| Operational acceptance/support owner | All; missing | Before activation | Organisational role decision and Assignment | Yes |
| Technical owner | All; missing | Before first implementation commit | Repository/code-ownership decision | No; blocks code |
| Adopted schema completeness | A incomplete; B/C/G strong; E catalogue-dependent; F view-dependent | Before code that produces/consumes it | Stage 5 reconciliation where identified | Candidate-specific |
| Schema versioning | Canonical cross-boundary candidates; missing | Before first versioned dependency or, if justified, integration | Governed convention | Candidate-specific |
| Implementation repository | All; missing | Before first code | Technical governance | No; blocks code |
| Architecture | General boundary satisfied by ADR-001 and ADR-005–011 | Candidate review before code | Architecture review | No general blocker |
| Identity/security/AUTHMOD | Protected paths; general contract exists, scope decisions missing | Design before code; enforce before integration | Business data owner, AUTHMOD, security review | Candidate-specific |
| Technology/storage/hosting | Implementation-dependent; unselected | Before choice shapes code or integration | Evidence-backed decision | No |
| Configuration/secrets | Provider/runtime-dependent; unselected | Before protected integration | Technical owner | No |
| Legacy coexistence | A/B/F and current-source G; direction missing | Before activation if authority changes, otherwise before shadow/integration | Business/operational owner under ADR-010 | Candidate-specific |
| Safe test environment/data | All; missing | Before integration/workflow testing | Technical/security owners | No |
| Acceptance authority | All; missing role | Role before activation; evidence before Stage 7 completion | Business/operational roles | Yes for role |
| Recovery/support | All; missing | Owner before code; evidence before Stage 7 completion | Operational/technical owners | No; later blocker |
| Release authority | Production only; ungranted | Before rollout | Governed release authority | No; rollout blocker |
| Stage 8 | All; Planned | After Stage 7 completion evidence | Stage 8 governance | No |

## Stage 7 and Stage 8 boundary

Stage 7 does not start through this record. After governed selection and satisfaction of activation blockers, activation should mean “Increment 1 selected; implementation not yet started.” Code begins only after all before-first-code prerequisites are satisfied.

- Stage 7 owns bounded implementation, pre-rollout tests, contract conformance, security checks, observability, recovery, coexistence evidence and documentation.
- Stage 7 completes only when the charter and Definition of Done are evidenced and a Stage 8 entry package exists.
- Stage 8 validates operational adoption, controlled pilot/shadow/parallel behaviour where applicable, business acceptance, release readiness, rollout monitoring and recovery.
- Production deployment, migration, cutover and retirement remain unauthorised.
- Contradictory evidence returns to the earliest affected stage.

## Explicit exclusions

This review does not create a charter, activate Stage 7 or Stage 8, select technology or a repository, create or reconcile schemas, change BDR Decisions, define deferred policy, authorise production work, or alter any live workflow.

## Evidence references

- [Documentation governance](../documentation-governance.md)
- [Stage 6 closure](stage-6-closure-2026-07-27.md)
- [Stage 7](stage-7-implementation.md)
- [Stage 8](stage-8-validation-and-rollout.md)
- [Application inventory](../../inventory/applications.md)
- [Historical priorities](../../inventory/priorities.md)
- [Performance evidence](../../inventory/performance-issues.md)
- [Hospitality Booking audit](../../inventory/reports/hospitality-booking-platform-family.md)
- [Hospitality Dashboard audit](../../inventory/reports/hospitality-dashboard-family.md)
- [CPU Production audit](../../inventory/reports/cpu-production-dashboard.md)
- [Schema catalogue](../../schemas/README.md)
- [ADR index](../decisions/README.md)
- [Definition of Done](../engineering/definition-of-done.md)
- [Testing strategy](../engineering/testing-strategy.md)

## Review verdict

The repository contains multiple credible but materially different first increments. It does not contain authority to prioritise one, complete its accountability set or accept its operational risk. The correct governed result is **No Selection**.

**Stage 7 remains Planned. Stage 8 remains Planned. Application implementation has not started.**
