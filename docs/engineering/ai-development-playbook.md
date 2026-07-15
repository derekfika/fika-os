# AI Development Playbook

## Purpose

ChatGPT and Codex are complementary collaborators in FIKA Platform development. They support reasoning and execution; neither supplies missing business facts or independent authority to change production systems.

Human owners approve business meaning, risk, permissions, production actions and releases. Schema Packs complete and integrate autonomously once no Human Decision Gate remains.

## Responsibilities

### ChatGPT

Use ChatGPT primarily as the collaborative thinking surface for:

- clarifying outcomes, users, rules and trade-offs;
- shaping discovery questions and business decisions;
- reviewing architecture and domain language;
- drafting reusable prompts and communication;
- explaining findings at the appropriate level;
- maintaining decision continuity with the human owner.

### Codex

Use Codex primarily as the workspace execution surface for:

- reading repository instructions and evidence;
- inventorying files, contracts, dependencies and duplication;
- implementing authorised, scoped changes;
- running documented validation and tests;
- producing diffs, reports and traceable artefacts;
- preserving unrelated work and observing repository constraints.

The same task may move between both surfaces. Handoffs must state scope, evidence, decisions, files, constraints, unresolved questions and authorised actions.

## Shared operating rules

- Read the applicable `AGENTS.md`, architecture, ADRs, README and task evidence before acting.
- Distinguish confirmed facts, code evidence, inference, proposal and TODO.
- Do not invent production behaviour, identifiers, owners, URLs, users or criticality.
- Do not expose secrets or private data.
- Do not infer permission to deploy, push, commit, message users, mutate external systems, or broaden scope.
- Preserve working systems and unrelated user changes.
- Prefer small, reviewable, reversible changes with proportional tests.
- Summarise outcomes, checks, risks and unresolved decisions.

## Development lifecycle

### 1. Discovery

ChatGPT helps frame the business problem, owner, users, current friction, desired outcome, constraints and unknowns. Codex reads authorised repositories and documentation, produces an evidence inventory, and marks gaps without changing behaviour.

Output should separate confirmed current state, suspected findings, questions, risks and recommended next evidence.

### 2. Architecture

ChatGPT facilitates domain/source-of-truth discussion and challenges conflated concepts. Codex maps current dependencies, producers, consumers, projections, adapters and migration constraints.

Use the architecture review checklist. Record material decisions in an ADR. Architecture work does not authorise implementation.

### 3. Schema design

Start from confirmed business meaning and downstream requirements, not current row/file layouts. Define ownership, stable IDs, versions, timestamps, required/optional fields, statuses, money/units/time, source references and validation.

Codex may draft schemas, fixtures and validation only when authorised. ChatGPT helps review ambiguity and business vocabulary. Keep provider/parser metadata separate. Label drafts clearly until adoption is approved.

### 4. Implementation

Provide Codex with exact scope, allowed repositories/files, acceptance criteria, prohibited actions, applicable decisions, tests and release authority. Codex inspects before editing, follows local conventions, changes only what is necessary, and verifies proportionately.

Do not combine a risky refactor with a feature unless explicitly reviewed. Do not deploy or commit unless requested.

### 5. Review

Codex reviews the actual diff and test evidence for correctness, regressions, security, performance, accessibility, documentation and unintended files. ChatGPT helps assess whether the outcome satisfies the business intent and whether unresolved decisions are acceptable.

Review should lead with material findings. Absence of findings does not replace testing.

### 6. Refactoring

Refactor only with a clear objective: reduce verified duplication, isolate a boundary, improve testability, resolve measured performance, or enable an approved migration.

First establish behaviour and fixtures. Separate mechanical moves from semantic change. Preserve app-specific rules. Compare before/after behaviour and retain rollback. Similar code alone is insufficient evidence for consolidation.

### 7. Performance

ChatGPT helps define the user-visible problem and acceptable target. Codex measures representative data, calls, payloads, latency, concurrency and failures before proposing changes.

Optimise the proven bottleneck, remeasure, and verify correctness/recovery. Label unmeasured code smells as risks, not incidents.

### 8. Documentation

Codex updates README, ADRs, schemas, runbooks, diagrams and inventories with the same change when applicable. ChatGPT helps make decisions understandable and stable.

Documentation must state authority, status, assumptions, operational steps, tests, rollback and TODOs without sensitive values.

## Prompt construction

A strong task prompt includes:

1. outcome and business context;
2. files/repositories to read;
3. exact scope and prohibited actions;
4. confirmed decisions and terminology;
5. required outputs and allowed files;
6. validation and acceptance criteria;
7. final reporting format;
8. unresolved facts that must remain TODO.

## Handoff template

```text
Objective:
Confirmed decisions:
Evidence read:
Files changed:
Checks completed and results:
Production/external actions performed: None / list explicitly
Risks and assumptions:
Unresolved decisions:
Recommended next step:
```

## Stop and escalate conditions

Pause and request human direction when:

- a missing business decision materially changes the result;
- required authority would broaden scope or mutate production/external state;
- instructions conflict or the applicable repository rules are unavailable;
- secrets/private data cannot be avoided safely;
- unrelated user changes overlap materially;
- tests reveal a risk outside the authorised change;
- rollback or recovery is not credible for the proposed mutation.

TODO: Confirm approved AI data-handling policy, review authority, and whether particular repositories require mandatory human review before any change.
