# FIKA OS — Logging, Audit and Operational Evidence Strategy

This document defines the FIKA OS approach to **business audit history, technical diagnostics and long-term archival**.

It is a standing platform requirement. Read it alongside repository-root `AGENTS.md`, `COST-EFFICIENCY.md`, `docs/ai/CODEBASE-AUDIT-PROTOCOL.md` and `docs/ai/GO-LIVE-READINESS-SCAN.md`.

The objective is to make FIKA OS operationally reconstructable without turning logging into an uncontrolled Firestore/read-write cost or creating a second business-data system.

---

## 1. Core principle

FIKA OS must be able to answer, for every important business mutation:

> **Who did what, when, from which app, to which entity/version, why where relevant, and what was expected to propagate downstream?**

That does **not** mean every page render, GET request, poll, cache refresh or UI interaction belongs in the business audit trail.

Keep three concerns separate:

```text
Business audit events
    = durable operational evidence

Technical/application logs
    = diagnostics and observability

Google Drive archive
    = long-term exported copy / recovery evidence
```

Do not collapse these into one giant logging mechanism.

---

## 2. Business audit events

Business audit events are append-only records of meaningful state changes.

Examples include:

- booking created/submitted/reviewed/amended/cancelled;
- quote generated/regenerated/superseded;
- menu generated/published/withdrawn;
- allergen declaration changed;
- Ad-Hoc request created/reviewed/sent/amended/cancelled;
- Production Order created/amended/released/cancelled/completed;
- Fulfilment Requirement created/amended/withdrawn;
- Logistics job assigned/moved/collected/dispatched/completed;
- governed configuration or OPLOC change;
- privileged administrative action;
- import/promotion/reconciliation action that changes authoritative business state.

Read-only actions do not normally require business audit events.

Do not create business audit documents for:

- ordinary page views;
- component renders;
- routine projection refreshes;
- background polling that discovers no change;
- cache hits;
- health checks;
- successful GET requests with no state change;
- hover/focus/navigation behaviour.

Those belong, if needed at all, in technical diagnostics.

---

## 3. Prefer existing domain/change events over duplicate audit writes

FIKA OS already uses domain events, append-only change stacks, projections and fulfilment events in several core paths.

Where an existing durable domain/change event contains enough evidence to reconstruct the business mutation, **that event should also serve as the audit record**.

Prefer:

```text
authoritative state write
+
durable domain/change event
    ↑
    also business audit evidence
```

over:

```text
state write
+
domain event
+
third duplicate audit document
```

Do not introduce a new `auditLogs`/`notifications`/`history` collection automatically when the existing event stream already provides the required immutable evidence.

If the current event shape is insufficient, extend it deliberately or create a compatible audit event at the authoritative boundary rather than logging the same mutation independently from the UI.

---

## 4. Minimum audit-event evidence

For meaningful mutations, the durable evidence should contain or make reliably derivable:

- stable event ID;
- event/action type;
- entity/domain type;
- stable entity ID;
- entity version/revision before and/or after where the domain versions records;
- UTC event timestamp;
- operational date/time context where relevant, using explicit `Europe/London` semantics rather than ambiguous local conversion;
- actor stable ID;
- actor display information where appropriate for human review;
- source application / command origin;
- site/OPLOC scope where relevant;
- correlation ID / causation ID / source event ID where a mutation crosses applications;
- idempotency key where relevant;
- concise before/after fields or structured change summary for important mutable business values;
- reason/comment when the workflow requires one, especially cancellation/withdrawal/override actions;
- downstream/source references necessary to trace lineage.

Do not duplicate enormous entity payloads into every event without a business reason. Prefer concise structured diffs plus stable references/version snapshots where the domain already preserves immutable evidence.

Never use a staff display name as the only actor identity.

---

## 5. Audit events are append-only

A business audit record is historical evidence.

Do not edit an old event to reflect current state.

Corrections should create a new event explaining the correction/supersession.

The audit trail must distinguish:

- original action;
- later amendment;
- cancellation/withdrawal;
- supersession;
- retry/replay of an existing command;
- system-generated propagation from a user-originated action.

A current-state projection may change freely according to the domain lifecycle; historical audit evidence does not.

---

## 6. Atomicity and reliable recording

For important operational mutations, avoid this failure mode:

```text
business state committed ✓
audit/event recording failed ✗
response still reports success
```

Where authoritative state and audit/domain event share a datastore and transaction mechanism, commit them atomically where practical.

Where a mutation crosses stores or services and true atomicity is unavailable, use an existing durable event/outbox/change-stack pattern or an equivalent reliable mechanism so audit/downstream propagation can be retried safely.

Do not perform a best-effort client-side audit POST after a business command and treat that as sufficient evidence.

The authoritative server/domain boundary owns business audit creation.

---

## 7. Cross-app traceability

A cross-app workflow must be traceable without relying on display names or timestamps alone.

For example:

```text
Hospitality booking
  bookingId / version
       ↓
Production Order
  sourceReference + productionOrderId
       ↓
Fulfilment Requirement
  source identity + requirementId
       ↓
Logistics job/run
  fulfilment/source references
```

The same principle applies to Ad-Hoc, Menu-originated and Grab & Go work.

Use stable source IDs, versions, correlation/causation IDs and event IDs so an investigator can follow one user action through every affected app.

A later amendment must retain lineage to the original logical object rather than appearing as an unrelated new job unless the business domain genuinely defines it as new work.

---

## 8. Technical/application logs

Technical logs are for diagnosing the application, not for proving business history.

Examples:

- API request failed;
- Firestore query took 900 ms;
- projection refresh failed;
- Google API returned 429;
- event consumer retry occurred;
- SQLite lock/retry warning;
- downstream handoff timed out;
- unexpected schema validation failure;
- background task started/completed/failed.

Do **not** create one Firestore document per technical log line by default.

Prefer structured application/server logging appropriate to the runtime, such as stdout/server logs or bounded/rotating local structured logs during the current local-first phase.

Recommended fields include:

- timestamp;
- level;
- app/service;
- event/message code;
- correlation ID;
- request/command ID;
- relevant entity ID where safe;
- duration where relevant;
- error class/code;
- retry count;
- concise diagnostic context.

Never log credentials, auth tokens, secrets or unnecessary personal/sensitive payloads.

Avoid dumping full booking/menu/allergen/customer objects into generic exception logs.

---

## 9. Correlation IDs

Use correlation/causation identifiers wherever they materially improve cross-app diagnosis.

A single initiating action should ideally be traceable through technical and business evidence, for example:

```text
manager clicks Send to CPU
correlationId: corr_123

Hospitality command event        corr_123
Production materialisation       corr_123
Fulfilment creation              corr_123
Logistics projection/change      corr_123
technical retry/error logs       corr_123
```

Do not generate unrelated correlation identities at every hop if an existing stable source/causation identity can be propagated.

---

## 10. Firestore/read-write cost discipline

Auditability is required, but it must obey `COST-EFFICIENCY.md`.

Rules:

- emit audit/domain events only on meaningful state changes;
- do not write audit events on polls/reads that discover no change;
- reuse existing domain/change events where possible;
- do not add a broad realtime listener just to display history;
- history/audit screens should query a bounded entity, date range, app, site or cursor window;
- paginate growing history;
- do not reread the whole audit trail on dashboard refresh;
- avoid repeated writes carrying huge unchanged payload snapshots;
- document any new recurring archive/export job and its expected cadence/cost;
- measure actual event volume during UAT rather than guessing from local emulator behaviour.

The target is a **write-light, read-rarely business audit trail** rather than a chatty telemetry database.

---

## 11. Google Drive is an archive, not the live audit database

Google Drive may be used for long-term archive/export of audit events and technical logs.

Do not write every individual log event directly to a Drive document/file as the primary logging mechanism.

Prefer batching:

```text
operational events / logs
      ↓
hourly/daily/weekly export job as justified
      ↓
Google Drive archive
```

A possible layout is:

```text
FIKA OS Audit Archive/
  2026/
    08/
      hospitality-2026-08-25.jsonl
      cpu-2026-08-25.jsonl
      logistics-2026-08-25.jsonl
```

The exact file cadence and retention period must be an explicit operational decision; do not invent a retention period in code.

For an archive batch, consider recording:

- export timestamp;
- source app/domain;
- first/last event ID or cursor;
- event count;
- source date range;
- checksum/hash or equivalent integrity metadata where useful;
- export status/retry evidence.

The Drive copy is an archive/recovery artifact. It is not the authority for current operational state and should not be required for ordinary dashboard reads.

---

## 12. Audit/history UI

A human-readable History/Audit screen may project the durable business events.

It should be:

- bounded;
- paginated or cursor-based as volume grows;
- filterable by entity/site/date/action where useful;
- clearly ordered;
- explicit about actor, action, timestamp and source;
- capable of showing the logical lineage of amendments/cancellations where practical.

Do not make every operational dashboard subscribe continuously to the full history stream.

Audit/history UI is a projection. The event source remains the evidence.

---

## 13. What the forensic audit must verify

During the post-UAT forensic audit defined in `CODEBASE-AUDIT-PROTOCOL.md`, every core application must contain an explicit **Auditability and Observability** subsection.

For each core app, inventory every meaningful mutation path and determine:

1. What authoritative entity changes?
2. What durable audit/domain event proves the change?
3. Is the event written at the server/domain boundary?
4. Is the event atomic/reliable relative to the state mutation?
5. Does it contain stable actor identity?
6. Does it contain stable entity identity/version?
7. Can the event be correlated to upstream/downstream work?
8. Are amendments and cancellations distinguishable from original creation?
9. Are retries/idempotent replays represented without duplicate logical history?
10. Can events be modified or deleted accidentally?
11. Are important privileged/config/safety actions covered?
12. Are technical failures diagnosable without relying on business audit events?
13. Are technical logs leaking sensitive information?
14. Are audit/history queries bounded and cost-conscious?
15. Is there enough evidence to reconstruct a representative UAT workflow end to end?

Mandatory high-value workflow evidence includes, where applicable:

- Hospitality booking submit → review → quote → CPU handoff → fulfilment → Logistics;
- Hospitality amendment after handoff;
- Hospitality cancellation after handoff;
- Ad-Hoc create/review → CPU handoff → amendment/cancellation;
- allergen declaration changes and source app;
- Production release/state transition;
- Fulfilment creation/amendment/withdrawal;
- Logistics assignment/movement/dispatch/completion;
- OPLOC/governed configuration changes;
- imports/promotions/reconciliation that mutate authoritative records.

If an important mutation has no durable evidence, record an audit finding rather than accepting application logs as a substitute.

---

## 14. What the go-live readiness scan must verify

The final go-live readiness scan should not merely check that an `audit` collection/table exists.

It must prove on the exact release candidate that:

- representative state changes leave durable evidence;
- evidence identifies the real actor, action, entity, version and source;
- a representative cross-app workflow can be reconstructed;
- cancellation/amendment lineage is visible;
- technical failures produce useful diagnostics;
- failed audit/event persistence cannot silently masquerade as successful critical state change;
- audit queries do not require broad/unbounded reads;
- logging does not create disproportionate recurring Firestore writes;
- secrets/sensitive payloads are not exposed in logs;
- any configured Drive archive job is bounded, retry-safe and independently testable;
- archive failure does not corrupt the live operational system.

---

## 15. Implementation sequence

Do not build a giant central logging platform before UAT proves the actual gaps.

Recommended sequence:

```text
1. UAT the current workflows
2. Inventory existing domain/change/audit evidence
3. Identify missing critical mutations
4. Harden event shapes / atomicity / correlation where needed
5. Add bounded human-readable audit projections where operationally useful
6. Add structured technical logging where diagnostics are weak
7. Add Drive batch archival only when retention/archive requirements are agreed
8. Measure real read/write volume
9. Verify during forensic audit
10. Verify again during go-live readiness scan
```

The goal is **complete operational evidence with minimum duplicated infrastructure**.
