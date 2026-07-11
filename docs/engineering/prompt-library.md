# Prompt Library

## How to use

Replace bracketed placeholders, remove irrelevant clauses, and include applicable `AGENTS.md`, ADRs, schemas, inventories and reports. Never insert secrets or private customer data. A prompt grants only the actions it explicitly authorises.

## Repository audit

```text
Read [AGENTS/architecture/inventory files] fully.

Inspect only [repository/family/path]. Do not modify code, configuration, deployments, commits, or external systems. Do not expose secrets, identifiers, private URLs, or customer data.

Determine from evidence:
- purpose, lifecycle clues and users/owner where confirmed;
- technologies, structure, setup and documentation;
- authoritative records, projections and adapters;
- integrations and configuration boundaries;
- shared/duplicate code and genuine business differences;
- large/overloaded files, reliability and security risks;
- missing facts requiring TODO.

Write [output report]. Update only [authorised inventory files].

End with confirmed findings, suspected findings, manual questions, risks and recommended next inspection.
```

## Performance audit

```text
Read [governing files and existing performance inventory].

Audit [workflow/application] without changing production behaviour. Measure where safe tooling and representative non-private data are available; otherwise identify code patterns as suspected risks, not confirmed incidents.

For each workflow record:
- user-visible symptom and acceptance target (TODO if unknown);
- dataset size, calls/effects, payload, first/repeat timings and concurrency;
- failure, retry, quota, partial-processing and recovery behaviour;
- baseline evidence and measurement method;
- likely bottleneck and smallest reversible experiment.

Do not optimise or refactor.
Write [report/inventory files]. End with measurements, unmeasured risks, business impact questions and recommended experiments.
```

## Schema review

```text
Read [domain model, schemas, fixtures, ADRs, producer and consumer evidence].

Review draft [SchemaName/version]. Do not modify schemas, fixtures, production code or deployments.

Evaluate:
- ownership and source-of-truth;
- required/optional fields and weakly evidenced names;
- stable IDs, record/schema versions, timestamps and actors;
- status ownership, money, units, time zones and locations;
- provider/parser metadata separation;
- compatibility with each confirmed producer and consumer;
- validation gaps, ambiguity and migration risk.

Classify each issue as confirmed defect, clarification, downstream concern, adapter metadata or future decision. Use TODO rather than speculation.

Write [review report]. State whether the draft remains sound and whether evidence is sufficient for an adoption decision.
```

## Architecture review

```text
Read [principles, target architecture, ADRs, relevant inventories and proposal].

Review [capability/proposal] using docs/engineering/architecture-review-checklist.md. Do not implement anything.

Assess business ownership, domain boundary, source-of-truth, schemas, repository abstraction, integrations/adapters, configuration, permissions, user experience, performance, reliability, migration and rollback.

Separate confirmed evidence, assumptions, decisions required and recommendations. Identify whether an ADR is required.

Return one outcome: Approved, Approved with conditions, More evidence required, or Rejected. Only a confirmed human authority may turn that outcome into implementation approval.
```

## Domain discovery

```text
Read [scope, principles, current/target maps, future-domain entry and inventories].

Investigate [domain] using only [authorised repositories/documents/interviews]. Do not create final schemas or implement applications.

Identify:
- business owner and users (TODO if unconfirmed);
- problem, terminology and current manual/system workflow;
- lifecycle/status concepts and business decisions;
- candidate entities and boundaries;
- sources of truth, projections, adapters and integrations;
- volumes, permissions, privacy, retention and reporting needs;
- dependencies on existing domains;
- ambiguity and risks.

Write [discovery report]. End with the minimum decisions/evidence needed before schema design.
```

## Implementation

```text
Read [AGENTS.md, README, ADRs, standards, schema/contracts and relevant tests].

Implement [exact capability] in [authorised repository/files]. Acceptance criteria:
- [criterion]
- [criterion]

Do not modify [prohibited files/systems]. Do not commit, push, deploy, message users, or mutate external/production state unless explicitly authorised.

Preserve unrelated changes and current behaviour outside scope. Follow established contracts, configuration and error conventions. Add/update proportional tests and documentation.

Run [documented checks]. If a missing business decision materially changes the implementation, stop and ask rather than guessing.

End with files changed, behaviour delivered, checks/results, risks, TODOs and safe next steps.
```

## Refactor

```text
Read [instructions, architecture, current audit, fixtures and regression tests].

Refactor only [bounded component] to achieve [measurable objective]. Preserve externally observable behaviour and genuine variant rules. Do not change schemas, business rules, production configuration or deployments.

Before editing, document the current contract and ensure regression coverage for [critical cases]. Separate mechanical structure changes from semantic changes. Keep adapters and domain logic distinct.

Run before/after tests and [performance measurements if relevant]. Provide a rollback path.

End with structural changes, proof of preserved behaviour, measurements, remaining duplication and risks.
```

## Security review

```text
Read [AGENTS.md, architecture, permissions/data policy, relevant code/config docs].

Perform a read-only security review of [scope]. Do not expose secrets or private data; report locations and risk categories without reproducing values.

Review:
- authentication and authoritative permission enforcement;
- least privilege and site/client isolation;
- secret/configuration handling;
- input validation, output escaping and injection risks;
- personal-data minimisation, retention and logging;
- idempotency, concurrency, audit attribution and unsafe effects;
- dependency/integration failure and recovery;
- release, rollback and operational access.

Rank findings by impact and evidence. Distinguish confirmed vulnerabilities, hardening recommendations and unknown policy decisions. Do not implement fixes unless separately authorised.
```

## UI review

```text
Read [brand/UX standards, scope, user workflow and relevant application docs].

Review [UI/page/flow] without changing behaviour unless explicitly authorised. Use safe non-private data.

Assess:
- task clarity, terminology, hierarchy and next actions;
- responsive layout and supported viewports;
- keyboard use, focus, labels, contrast and reduced motion;
- loading, empty, validation, success, warning, error and recovery states;
- permission-denied and partial-data behaviour;
- performance and unnecessary interactions;
- consistency with canonical status and source-of-truth.

Report evidence-backed findings by severity, with exact locations and acceptance criteria. Separate defects from preferences and unconfirmed business questions.
```

## Standard closing clause

Append when useful:

```text
Do not invent production facts. Use TODO for unresolved business information. Do not expose secrets, private identifiers, URLs, or customer data. Review affected files, links, terminology, scope and unintended changes before finishing.
```
