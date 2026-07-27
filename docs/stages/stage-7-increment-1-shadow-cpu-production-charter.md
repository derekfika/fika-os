# Stage 7 Increment 1 Charter — Shadow CPU Production Intake and Reconciliation

**Status:** Chartered — Stage 7 Active; implementation not started

**Selection date:** 2026-07-27

**Selected outcome:** Shadow CPU Production intake and reconciliation

**Governed selection authority:** Derek's explicit decision supplied on 2026-07-27

**Supersedes:** The No Selection gate in the [first-increment selection review](stage-7-first-increment-selection-2026-07-27.md), prospectively only

## Decision

Stage 7 is activated solely around this Increment 1 charter. The increment will prove that FIKA OS can observe one bounded existing CPU intake, construct a governed but non-canonical shadow interpretation of relevant Production facts, and reconcile it against the current operational view without changing the live CPU workflow or producing operational effects.

Activation authorises resolution of the prerequisites recorded here. It does not authorise code until every before-first-code gate is satisfied, and it does not authorise real-source access, integration, release, rollout, migration, cutover or retirement.

The earlier No Selection decision remains historically correct: the required business priority and accountable roles were absent at that time. Derek's later decision supplies that authority and selects the strongest alternative recorded there.

## Identity and migration unit

### Increment identity

- **Name:** Shadow CPU Production Intake and Reconciliation
- **Stage:** Stage 7 — Implementation
- **Implementation state:** Not started
- **Operational capability:** Production observation and reconciliation only
- **Affected domains:** Production, with qualified Booking-derived and Operational Location observations
- **Stage 8:** Planned and not activated

### Bounded first scope

The smallest safe migration unit is:

> one currently configured CPU Calendar intake scope, mapped to one producing CPU represented by one governed Operational Location, observed over one bounded snapshot/replay window and compared with the corresponding CPU Orders operational projection.

The exact Calendar configuration reference, producing CPU/Operational Location, snapshot window and delegated Head Chef are not present in the specification repository. They must be verified and recorded before the first implementation commit. The verification must select an existing configured intake; it must not add a Calendar, location, feed or user.

The first scope includes only source observations attributable to that one configured intake and producing CPU. It excludes other CPUs even if the current dashboard scans them in the same application.

### Distinct scopes

| Concept | Increment interpretation |
|---|---|
| Producing CPU | The one selected Operational Location where the observed Production work is performed; exact identity is a pre-code gate. |
| Requesting Operational Location | The location requesting or originating the hospitality demand, if defensibly evidenced; it is not the producing CPU by default. |
| Service/destination location | The location, floor, room or delivery context where service is expected; it is not a producing facility or requesting location by implication. |
| Discovery source | One currently configured Calendar intake and its authorised attachment references. Calendar is evidence, not canonical Production identity. |
| Current dashboard scope | The CPU Dashboard's broader configured scan estate; only the selected intake subset enters Increment 1. |
| Shadow Production Order scope | Non-canonical comparison representation derived from one observed source occurrence and qualified mappings. |
| Review population | Derek, Sam and the Head Chef delegated for the selected CPU only. |
| Acceptance authority | Derek for product; Sam for Production, with bounded CPU review/acceptance delegable to the selected Head Chef. |

The scope definition is invalid if one configured Calendar intake cannot be isolated without adding sources or exposing another CPU's data. In that event, return to this charter before code.

## Outcome and learning

### Immediate users and reviewers

- Derek, accountable FIKA OS product owner and initial technical-support owner for Increment 1;
- Sam, accountable Production business and operational owner across the CPU estate; and
- the Head Chef explicitly delegated by Sam for the selected CPU scope.

No wider CPU team, Hospitality team, Client, customer, external user or unselected CPU is an Increment 1 user.

### Observable outcome

For the one bounded scope, authorised reviewers can inspect a reconciliation report that states:

- what source evidence was observed and as of when;
- which qualified Production Order and Production Line interpretations could be constructed;
- which required Pack 6 fields were directly evidenced, inferred, missing, ambiguous, blocked or not applicable;
- where the shadow interpretation and current CPU Orders projection match or diverge by dimension;
- which records are missing, extra, duplicated, stale, incomplete, uncertain or quarantined;
- which mapping version produced the result; and
- who reviewed and accepted or rejected the result as shadow evidence.

### Value now

The increment tests FIKA OS boundaries against a real downstream workflow while preserving the current CPU operation. It reveals whether current intake evidence can support governed Production contracts before any canonical repository, live mutation or migration is attempted.

### Learning objective

Establish which Production facts can be mapped defensibly, which gaps require business/schema work, and which coexistence, identity and reconciliation controls are necessary for later CPU scopes.

### What the evidence proves

It may prove repeatable observation, qualified mapping, dimensional comparison, provenance preservation, discrepancy visibility, scoped human review and safe rerun within the declared scope.

It does not prove that a live order or Booking is correct, Production is ready, kitchen work is acknowledged, Pack 6 is universally sufficient, a cutover is safe, or Stage 8 rollout is authorised.

## Scope

### In scope

- authorised snapshot/replay input for one current configured Calendar intake;
- minimal attachment metadata or sanitised content needed to exercise existing JSON, quote/form and title/description evidence classes;
- read-only comparison with the corresponding CPU Orders projection snapshot;
- versioned shadow mapping logic in a later implementation task;
- non-canonical shadow Production Order/Line comparison representations;
- dimensional reconciliation, uncertainty, quarantine and review evidence;
- source, mapping, run, discrepancy and review identities;
- scoped AUTHMOD enforcement for read, compare, review, accept/reject shadow evidence, export and administer actions;
- test fixtures and controlled non-production evidence;
- automated and manual tests, observability, recovery instructions and runbook; and
- documentation of gaps returned to the earliest affected stage.

### Out of scope

- canonical Booking or Production mutation or repositories;
- complete Booking aggregate adoption or reconstruction;
- live Calendar, Drive, Sheet, attachment or dashboard writes;
- CPU state transitions including `READY`, `NEEDS_ATTENTION`, `CANCELLED`, preparation or completion;
- kitchen tasks, labels, delivery instructions, photos, notifications or document generation;
- quantity, unit, yield, routing, timing, dietary or allergen policy decisions;
- Logistics;
- historical migration beyond the controlled snapshot/replay evidence;
- additional CPUs, Calendars, feeds or users;
- dashboard replacement or UI redesign;
- provider, hosting, runtime, storage or identity-product selection;
- production deployment, live access, cutover, retirement or Stage 8 rollout.

## Responsibility and authority model

| Responsibility | Accountable authority | Delegation/boundary | Current evidence |
|---|---|---|---|
| Product accountability | Derek | Does not override Production safety or Canon | Explicitly supplied |
| Stage 7 charter acceptance — product | Derek | Joint with Production perspective | Explicitly supplied |
| Production business and operational accountability | Sam | Retained across the CPU estate; does not extend to Booking, Hospitality, Logistics, technology or platform ownership | Explicitly supplied |
| Stage 7 charter acceptance — Production | Sam | Joint with product perspective | Explicitly supplied |
| CPU-specific operational review | Head Chef delegated by Sam | One selected CPU and effective delegation period only | Role model supplied; identity pending |
| CPU-specific shadow-evidence acceptance | Head Chef delegated by Sam | Does not accept architecture, security, cross-CPU policy, Stage 8 entry or release; Sam retains accountability | Role model supplied; identity pending |
| Initial technical support | Derek | Increment 1 only; not permanent platform support, repository ownership or release authority | Explicitly supplied |
| Technical delivery ownership | TODO | Required before code; not inferred from Derek's support role | Unresolved |
| Information-security/access approval | TODO authorised role | Required before real-source integration | Unresolved |
| Implementation repository ownership | TODO | Required before code | Unresolved |
| Code-review authority | TODO | Required before code/merge | Unresolved |
| Stage 7 completion acceptance | Derek and Sam; delegated CPU evidence contributes | Technical completion authority also required | Product/Production supplied; technical role unresolved |
| Stage 8 entry authority | TODO governed authority, with Derek/Sam acceptance evidence | Delegated Head Chef cannot grant it | Unresolved; later gate |
| Production release authority | TODO governed authority | Not granted by this charter | Unresolved; rollout gate |

Sam's surname, formal job title, employment identity and reporting line are not recorded. No Head Chef is named. Durable Actor, Assignment, Authority Grant, delegation scope and effective-period references must be resolved before protected implementation/review activity. Temporary delegation requires a fixed end date and never transfers Sam's accountability.

## Domain and authority boundary

### Current authority

- Current configured Calendar events, attachments and CPU Sheets retain their existing operational role for the declared period.
- The CPU Dashboard remains the current system of execution and operational view.
- CPU Orders and Deliveries Sheets remain lossy operational projections, not canonical Production records.
- Governed BDRs and adopted Pack 6 schemas define target meaning but do not make shadow representations canonical.

### Shadow classification

The increment is an observation, mapping, reconciliation and review capability. Shadow records are comparison representations with provenance and uncertainty. They have no canonical-write or operational-execution authority.

### Write-direction register

| Observed or produced system | Read direction | Write direction |
|---|---|---|
| Current configured Calendar | Authorised snapshot/replay into shadow adapter | None |
| Drive/attachment evidence | Minimal authorised snapshot/reference into adapter | None |
| CPU Orders projection | Authorised snapshot into reconciliation | None |
| CPU Deliveries projection | Excluded unless required only to classify an observed source; otherwise none | None |
| Shadow mapping representation | Created only inside the isolated non-production boundary | Never written to canonical or live operational systems |
| Reconciliation evidence | Produced from source-qualified observations and shadow mappings | Written only to the selected non-production evidence store once authorised |
| Review/audit evidence | Authorised reviewer actions into governed evidence | No business or operational state transition |
| Exports | Generated only when separately authorised for the selected scope | No source write; access remains independently controlled |

A discrepancy never authorises overwrite. A match never transfers authority. Continuous operation of the live workflow is the fallback; there is no cutover to roll back.

## Governed contracts

### Applicable BDRs

- `PROD-001` through `PROD-005` — eligibility, timing, quantities/rules, change handling and routing;
- `BOOK-001` through `BOOK-007` — qualified source timing, item quantity, dietary, immutable amendment and source-reference meaning;
- `LOC-001` through `LOC-006` — stable Operational Location identity and boundaries;
- `CAP-001` through `CAP-004` — Production capability availability remains distinct from domain ownership and authority;
- `ROLE-001` through `ROLE-007` — role, Assignment, delegation, AUTHMOD, access and emergency-access boundaries;
- `SVC-003` — Production remains a separate domain; and
- `CLIENT-001` only where a source contains an optional Client relationship.

### Applicable schemas

- Pack 6 `production-order.schema.json` and `production-line.schema.json` are the target comparison contracts.
- `production-routing-allocation.schema.json` is inspected but not instantiated unless all required routing evidence already exists; routing policy is out of scope.
- `production-change-record.schema.json` is used only to classify amendment/cancellation evidence gaps; no change action is created.
- Pack 1 Operational Location, Pack 2 authority/capability and Pack 4 Booking component schemas constrain references and provenance.

Pack 6 is part of the adopted Stage 5 baseline despite historical `Draft` wording retained inside schema files. This charter does not alter that wording or any schema.

### Applicable ADRs

- ADR-001 — domain, Core and adapter boundaries;
- ADR-005 — source observations, event identity, idempotency, ordering and replay;
- ADR-006 — repository, consistency, concurrency and reconciliation;
- ADR-007 — projection freshness, rebuild and dashboard boundary;
- ADR-008 — principal/Actor mapping and AUTHMOD enforcement;
- ADR-009 — Booking-to-Production orchestration and qualified outcomes;
- ADR-010 — shadow coexistence, authority direction, fallback and retirement exclusion; and
- ADR-011 only to prohibit accidental notification effects.

## Booking boundary

Increment 1 requires no canonical Booking repository or complete Booking aggregate. Booking-derived observations retain channel, source reference, source timestamp/version where available, mapping method and evidence quality.

Legacy JSON is not declared a complete Booking. Missing Booking fields are not defaulted. The shadow mapper uses only facts needed for Production comparison and classifies each as directly supplied, reconstructed, inferred, absent or uncertain. Any result requiring complete Booking eligibility, authoritative commercial status or a missing aggregate field is marked blocked/deferred to bounded Stage 5 reconciliation.

## Pack 6 field applicability

### Production Order

| Field or meaning | Shadow classification | Treatment |
|---|---|---|
| `schemaVersion` | Direct contract reference | Record the Pack 6 target version and separate shadow mapping version; repository-wide compatibility policy remains pre-code. |
| `productionOrderId` | Missing/unsafe automatically | Generate only a namespaced shadow identity, never a canonical ID; do not reuse Calendar identity. |
| `sourceBooking.bookingId` | Direct where recognised JSON supplies it; otherwise legacy-derived/missing | Preserve provenance; do not manufacture a canonical Booking ID. |
| `sourceBooking.bookingVersion` | Frequently missing/ambiguous | Record absence or available source version evidence; do not default to `1`. |
| `ownership` | Blocked for schema-conformant shadow record until role/Assignment references exist | Use separate comparison metadata until governed references resolve; do not invent IDs. |
| `eligibility.bookingApprovalReference` | Missing/ambiguous in current projection | Cannot infer from CPU `READY` or Calendar presence. |
| `eligibility.operationalFulfilmentRequired` | Transformable only from governed eligibility evidence | Calendar intake alone does not prove it. Mark blocked where absent. |
| `lifecycleStatus` | Unsafe automatically | CPU `READY`, `NEEDS_ATTENTION`, `CANCELLED` are not Pack 6 lifecycle states. Do not map automatically. |
| `customerCommitment.serviceAt` | Often legacy-derived/transformable | Preserve whether parsed service time or Calendar time supplied it and timezone confidence. |
| `expectedDeliveryAt` | Semantically ambiguous | Current “delivery” may mean dispatch, arrival or handover. Compare as qualified source evidence only. |
| `productionLineIds` | Shadow-transformable when source lines are distinguishable | Use shadow line identities; never rely on display-name grouping alone. |
| `routingAllocationIds` | Blocked/not applicable to first comparison | Do not invent routing, capacity or delivery-rule references. |
| `requiredReadyAt` | Missing/semantically ambiguous | Mandatory in Pack 6; its absence makes a schema-complete Production Order unavailable and must be visible. |
| `productionStartAt` | Optional/missing | No inference. |
| `provenance` | Directly required | Capture source class/reference, observation time and mapping version without copying raw content unnecessarily. |
| `audit` | Not directly supplied by legacy intake | Shadow processing/review evidence remains separate; do not fabricate canonical audit events. |

### Production Line

| Field or meaning | Shadow classification | Treatment |
|---|---|---|
| `productionLineId` | Missing/unsafe automatically | Create only a namespaced shadow identity tied to mapping run and source occurrence. |
| `productionOrderId` | Shadow reference only | References the shadow order representation, never a canonical order. |
| `ownership` | Missing until role/Assignment evidence | Do not infer from event owner or display category. |
| `sourceBookingItemIds` | Direct only where stable IDs exist; otherwise missing | Legacy display lines do not become canonical Booking Item IDs. |
| `orderedSnapshot.quantity` | Often legacy-derived | Preserve parser evidence and ambiguity; positive numeric parsing does not prove unit semantics. |
| `orderedSnapshot.unitLabel/reference` | Frequently missing/ambiguous | Do not infer people, portions, platters, trays, pieces or weight. |
| `productionQuantity` | Blocked by unresolved conversion/yield policy | Never equate ordered numeric quantity with production quantity automatically. |
| `productionRuleSnapshot` | Missing/blocked | No yield, recipe, conversion, batch or aggregation catalogue is established by current intake. |
| `aggregationGroupReference` | Unsafe automatically | Keyword category/display-name grouping is integration behaviour, not stable production identity. |
| `provenance` | Required | Attribute source line/text/attachment class and mapping version. |
| `audit` | Not directly supplied | Keep shadow processing and review evidence separate. |

### Other observed facts

- producing CPU, requesting Operational Location and destination are resolved independently;
- dietary/allergen text is preserved as qualified evidence and never automatically allocated to a line;
- kitchen-only notes, parser warnings, raw-source references, prep/photo state and dashboard readiness remain integration/workflow evidence;
- cancellation, disappearance and amendments remain observations until governed Production handling can be evidenced; and
- price and commercial status are not required merely because source documents contain them.

The field review shows that meaningful dimensional reconciliation is possible, but schema-complete canonical Production records are neither expected nor authorised.

## Source and mapping boundary

| Source | Classification | Permitted use |
|---|---|---|
| Calendar event | Current discovery/integration envelope | Scope, event identity, timestamps and qualified service/delivery evidence |
| Recognised Booking JSON attachment | Preferred legacy structured evidence | Field-level mapping with source identity and uncertainty; never complete canonical Booking by declaration |
| Quote or booking-form document | Legacy parser evidence | Fallback comparison only; layout and labels remain adapter-specific |
| Event title/description/location/owner | Legacy inferred evidence | Use only with explicit inference classification; no silent precedence |
| Drive/file metadata | Provider observation | Stable reference, modified time and access outcome; raw content minimised |
| CPU Orders Sheet | Current operational projection | Reconciliation comparator, not canonical Production truth |
| CPU Deliveries Sheet | Operational projection | Out of first scope unless a selected record requires presence classification only |
| Parser warnings/raw event metadata | Integration evidence | Preserve uncertainty; never promote to domain fact |

The mapping specification must declare precedence only where current evidence supports it, record every fallback used, and carry a mapping version. It must not suppress ambiguity to increase apparent equivalence.

## Reconciliation contract

Reconciliation is dimensional. Each run records separate outcomes for:

1. selected-scope equivalence;
2. source coverage and freshness;
3. source and shadow identity resolution;
4. record presence, absence and extras;
5. duplicate suspicion;
6. ordering/version evidence;
7. semantic field comparability;
8. quantity and unit comparability;
9. time and timezone comparability;
10. producing CPU, requesting OPLOC and destination resolution;
11. Production-line identity and grouping;
12. dietary/allergen preservation;
13. amendment, cancellation and disappeared-source visibility;
14. warning and uncertainty preservation;
15. projection freshness/completeness;
16. technical processing outcome; and
17. human operational review.

Permitted qualified states are implementation vocabulary, not new business lifecycle states: `not_observed`, `out_of_scope`, `unresolvable`, `mapping_blocked`, `comparable`, `matched`, `diverged`, `duplicate_suspected`, `stale`, `incomplete`, `uncertain`, `quarantined`, `awaiting_review`, `reviewed`, `accepted_as_shadow_evidence` and `rejected_as_shadow_evidence`. They apply per dimension or evidence record, never as one universal match flag.

Acceptance as shadow evidence means only that the reviewer accepts the recorded comparison as useful evidence for its scope and `as of` time.

## Identity, ordering and idempotency

The implementation must keep distinct:

- source observation identity;
- Calendar event/source-record identity;
- legacy attachment/source reference;
- proposed shadow Production Order identity;
- proposed shadow Production Line identity;
- mapping-run identity;
- reconciliation-run identity;
- discrepancy identity;
- human-review identity; and
- export/report identity.

Repeated scans and overlapping windows must be duplicate-safe per source identity and mapping version. Attachment modifications, Calendar update timestamps, quote/form-only changes, cancelled or disappeared events, partial pages/batches, reordered observations, stale evidence and duplicate legacy sources remain visible.

An uncertain failure is reconciled before a rerun result is trusted. No global timestamp-wins rule applies. A rerun creates a new attributable run while preserving prior evidence; it does not silently overwrite history or trigger external effects.

## Security and data minimisation

Protected actions are: source read, shadow compare, discrepancy review, accept/reject shadow evidence, export and administration. Authentication evidence, Actor mapping, Assignment, Authority Grant, scope and domain acceptance remain distinct under ADR-008.

- Derek receives only the grants needed for product review and initial support.
- Sam receives Production review/acceptance access appropriate to accountability.
- A delegated Head Chef receives only CPU-specific review/acceptance access for the selected CPU and effective period.
- Cross-CPU access is denied by default.
- Source access does not imply permission to disclose or export shadow results.
- Contact, commercial, dietary/allergen, employee, raw-source and attachment data are minimised to necessary comparison evidence.
- Raw attachments are not copied by default; stable references and extracted minimal facts are preferred.
- Links and attachments remain independently access-controlled.
- Every review and acceptance action is attributable to an Actor, Assignment and Authority Grant.
- Safe fictional or sanitised test data is required before real-source integration.
- Retention and deletion remain unresolved and block real-source retention beyond an authorised ephemeral test boundary.
- Identity provider, secret store and access technology remain unselected.

## Observability, audit and reporting

Each run must evidence scope, `as of` time, available source versions/timestamps, mapping version, completed/failed/partial/uncertain outcomes, discrepancies by dimension, exclusions/minimisation, reviewer scope and action, unresolved items, freshness and change from prior runs.

Technical logs/metrics, provider observations, reconciliation evidence, governed review audit and business reporting remain distinct. Reports display selected CPU/intake scope and `as of` context. No universal performance target, equivalence threshold, cadence, retention duration or service level is authorised.

## Failure and recovery

- Shadow processing fails closed: it creates no canonical or operational effect.
- Unauthorised, cross-scope or unresolvable input is rejected or quarantined with attributable reason.
- Partial source snapshots and processing outcomes remain visibly incomplete.
- Rerun uses stable source/run identity and mapping version without erasing prior evidence.
- Evidence correction creates an attributable successor, not a silent rewrite.
- Reconciliation relies on source evidence available for the declared `as of` time.
- A shadow failure leaves the live CPU workflow uninterrupted; continuous live operation is the fallback.
- Recovery is replay/recalculation of isolated evidence, not rollback of Production.
- No notification, source write, task, label or other duplicate external effect can occur.

## Acceptance model

| Acceptance | Evidence | Authority | Does not mean |
|---|---|---|---|
| Product acceptance | Outcome is usable, bounded, attributable and meets charter | Derek | Production correctness or release authority |
| CPU-scope operational review | Dimensional discrepancies and source context are understandable for selected CPU | Delegated Head Chef, if appointed | Cross-CPU policy or Sam's accountability transfers |
| CPU-scope shadow-evidence acceptance | Comparison is useful and honest for its scope/time | Delegated Head Chef under Sam, or Sam directly | Live order acceptance, readiness, cutover or Stage 8 |
| Production acceptance | Increment respects Production meaning and safety | Sam | Booking, Logistics, technology or platform ownership |
| Technical completion | Tests, security, recovery, documentation and repository controls pass | TODO technical authority | Business acceptance or rollout |
| Stage 7 completion | Product, Production and technical evidence all pass | Derek and Sam plus TODO technical authority | Stage 8 entry or production release automatically |

## Prerequisite register

| ID | Description | Source/evidence and need | Accountable decision role | Required by | Status | Blocks activation/code/real source/completion/Stage 8 | Resolution evidence |
|---|---|---|---|---|---|---|---|
| INC1-PR-001 | Exact configured Calendar intake and producing CPU/OPLOC | Inventory proves multiple configured Calendars but names no safe pilot | Sam with Derek product agreement | First code | Open | No / Yes / Yes / Yes / Yes | Recorded existing configuration reference, governed OPLOC and one-CPU scope |
| INC1-PR-002 | Sam and delegated Head Chef durable identity/Assignment/delegation | Supplied authority lacks durable IDs; scoped review must be attributable | Sam / AUTHMOD administrator | Protected review; design before code | Open | No / Yes for access design / Yes / Yes / Yes | Actor, role Assignment, delegation scope and effective period |
| INC1-PR-003 | Technical delivery owner | Support is not delivery ownership | Derek/product governance | First code | Open | No / Yes / Yes / Yes / Yes | Explicit role assignment |
| INC1-PR-004 | Implementation repository and owner | No production repository selected; repository standards require ownership | Technical governance | First code | Open | No / Yes / Yes / Yes / Yes | Repository decision and code owner; no repository creation in this task |
| INC1-PR-005 | Schema versioning/compatibility convention | Pack 6 is adopted but cross-boundary convention is unresolved | Schema/platform governance | First code | Open | No / Yes / Yes / Yes / Yes | Governed convention covering referenced Pack 6 version and mapping compatibility |
| INC1-PR-006 | Pack 6 field applicability | This charter classifies fields; implementation mapping must preserve gaps | Derek and Sam, technical review | First code | Satisfied for charter; mapping spec pending | No / Yes for mapping spec / Yes / Yes / Yes | Reviewed field-level mapping specification without schema change |
| INC1-PR-007 | Legacy-source access | Calendar, Drive and Sheets contain protected operational evidence | Sam and information-security/access authority | Real-source integration | Open | No / No / Yes / Yes / Yes | Least-privilege grants and access test for selected scope |
| INC1-PR-008 | Safe test data | Production/private data cannot be fixtures | Derek, Sam and security authority | First integration test | Open | No / No if fictional fixtures first / Yes / Yes / Yes | Approved fictional/sanitised fixture set and handling record |
| INC1-PR-009 | Snapshot/replay approach | Must avoid live writes and nondeterministic evidence | Technical owner | First code | Open | No / Yes / Yes / Yes / Yes | Design proving bounded read-only capture, identity and repeatability |
| INC1-PR-010 | Sensitive-data minimisation and retention | Purpose known; retention duration is not governed | Sam and information-security/privacy authority | Real-source integration | Open | No / No / Yes / Yes / Yes | Field inventory, minimisation, access and approved ephemeral/retention rule |
| INC1-PR-011 | AUTHMOD design | CPU-scoped read/review/export must not leak cross-scope data | Sam, AUTHMOD and security authority | First protected integration | Open | No / Yes for design / Yes / Yes / Yes | Action/scope/grant matrix and denial tests |
| INC1-PR-012 | Bounded technology decisions | Runtime, storage, identity, observability and environment are open | Technical owner/governance | First code where choice shapes work | Open | No / Yes / Yes / Yes / Yes | Evidence-backed decision record(s), limited to Increment 1 |
| INC1-PR-013 | Reconciliation fixtures | Dimensional outcomes and uncertainty need repeatable cases | Technical owner with Sam review | First code/tests | Open | No / Yes / Yes / Yes / Yes | Valid cases for matches, gaps, duplicates, stale, cancellation, ambiguity and partial failure |
| INC1-PR-014 | Acceptance evidence | No numeric equivalence threshold is authorised | Derek and Sam | Stage 7 completion | Open | No / No / No / Yes / Yes | Product, Production and delegated CPU review records against charter dimensions |
| INC1-PR-015 | Support and incident route | Derek is initial support only; escalation/recovery route missing | Derek and Sam | Real-source integration | Open | No / No / Yes / Yes / Yes | Runbook, contacts by role, escalation and stop criteria |
| INC1-PR-016 | Stage 7 technical completion authority | Code-review and technical acceptance not assigned | Technical governance | Stage 7 completion | Open | No / Yes for code review / Yes / Yes / Yes | Named organisational role and review evidence |
| INC1-PR-017 | Stage 8 entry authority | Later rollout/validation authority not granted | Governance | Stage 8 entry | Open | No / No / No / No / Yes | Explicit Stage 8 entry decision after Stage 7 evidence |
| INC1-PR-018 | Production release authority | No production release is in Increment 1 | Governance/operations | Production rollout | Open | No / No / No / No / No; blocks rollout | Separate future release authority |

All activation blockers are satisfied by the supplied selection, product/Production ownership, delegated acceptance model, configuration-level migration unit and read-only authority direction. Open items are deliberately assigned to later gates.

## Technology and repository non-decisions

No runtime, framework, language, storage, database, hosting, identity provider, secret store, observability product, CI system, deployment topology or provider is selected. No implementation repository exists or is created. The future repository decision must identify accountable ownership, access, branch/review controls, validation commands, configuration/secrets boundary and dependency policy before code.

## Stage 7 Definition of Done

Increment 1 is implementation-complete only when:

- all charter and applicable prerequisite gates are resolved;
- the bounded scope and authority rules are enforced;
- Pack 6 field mappings preserve provenance, gaps and ambiguity;
- automated tests cover mapping, dimensional reconciliation, identity, duplicates, stale/partial/uncertain outcomes, unauthorised/cross-CPU access and safe rerun;
- manual review confirms operational usability for the selected CPU;
- no live source changes or external effects occur;
- performance is baselined without an invented target;
- observability, audit, recovery, minimisation and coexistence evidence exist;
- product, Production and technical completion authorities accept their respective evidence; and
- a Stage 8 entry package records what remains unvalidated in operational rollout.

Implementation complete does not mean production adopted.

## Stage 8 boundary

Stage 8 remains Planned. It may begin only after explicit entry authority reviews the completed Stage 7 evidence. Stage 8 would validate controlled use with authorised operational evidence, user acceptance, performance/recovery expectations and rollout readiness. No production release, canonical-write transfer, cutover, migration or retirement is authorised now.

## Future expansion and change control

Another CPU, Calendar, source class, write path, canonical repository, notification, workflow state, Logistics behaviour or policy is a separate increment or material charter amendment. Expansion requires evidence from the first scope and reassessment of authority, security, contracts, coexistence and acceptance. Contradiction with a BDR or adopted schema returns to the earliest affected stage.

## Activation verdict

**Stage 7 is Active — Increment 1 selected and chartered; implementation not yet started.**

The charter has a bounded configuration-level migration unit, authorised reviewers, explicit read-only direction and meaningful reconciliation outcome. Remaining CPU identity, technical ownership, repository, versioning, technology and access decisions are correctly timed before code or real-source integration rather than treated as activation blockers.

## Next bounded task

Resolve the complete **before-first-implementation-commit prerequisite bundle** without writing code:

1. verify one existing configured Calendar intake and its producing CPU/Operational Location;
2. record Sam's and the delegated Head Chef's durable scoped Assignment/delegation references;
3. appoint the technical delivery and code-review roles;
4. select the implementation repository and owner;
5. govern the schema-versioning/compatibility convention needed by Pack 6; and
6. make only the bounded technology decisions necessary to author the mapping, snapshot/replay and test plan.

Stop again before implementation.

## Evidence

- [Stage 6 closure](stage-6-closure-2026-07-27.md)
- [Prior selection review](stage-7-first-increment-selection-2026-07-27.md)
- [CPU Production audit](../../inventory/reports/cpu-production-dashboard.md)
- [Applications](../../inventory/applications.md)
- [Data sources](../../inventory/data-sources.md)
- [Integrations](../../inventory/integrations.md)
- [Pack 6 schemas](../../schemas/pack-6/README.md)
- [Pack 6 traceability](../schema-reviews/pack-6-bdr-to-schema-traceability.md)
- [ADR index](../decisions/README.md)
- [Testing strategy](../engineering/testing-strategy.md)
- [Definition of Done](../engineering/definition-of-done.md)
