# FIKA OS — Forensic Codebase Audit Protocol

This document defines how an AI agent must perform a **deep, evidence-led forensic audit of the FIKA OS launch candidate**.

The audit is intentionally performed **after the current UAT/snaggings pass is complete and the intended launch candidate has been frozen at an exact Git commit SHA**.

The purpose is not to redesign FIKA OS. The purpose is to prove whether the system that has emerged from UAT is internally correct, safe, coherent, resilient and ready to proceed to a final go-live readiness scan.

Read the repository-root `AGENTS.md` before beginning.

---

# 1. Required sequence

The release process is:

```text
Manual UAT + snagging
        ↓
Fix and retest snags
        ↓
Freeze exact launch-candidate SHA
        ↓
Forensic codebase audit
        ↓
Prioritised remediation
        ↓
Re-audit affected contracts
        ↓
Go-live readiness scan
        ↓
Release decision
```

Do not start the baseline forensic audit while product workflows are still being actively redesigned.

---

# 2. Primary audit scope

The deepest app-by-app audit is required for the current core operational platform:

1. **Integration Hub**
2. **Hospitality Booking Portals**
3. **Hospitality Manager Dashboards**
4. **CPU Production**
5. **Delivered-In**
6. **Logistics**
7. **Ad-Hoc Production**

These are the primary reports and must be inspected microscopically.

The audit must also inspect any **shared or adjacent code required to understand those apps correctly**, including:

- canonical Production Order contracts;
- Fulfilment Requirement contracts;
- OPLOC / governed-destination contracts;
- allergen contracts;
- shared actor/auth/session logic;
- event/outbox/change-feed/projection contracts;
- launcher/supervisor/deployment assumptions;
- Firebase rules/indexes/configuration;
- SQLite/file-backed stores used by a core app;
- shared UAT/test tooling;
- upstream/downstream modules that materially participate in a traced core workflow.

Do not spend the same depth on prototypes or unrelated apps unless a core flow depends on them. If Menu Planning, Grab & Go, Events, Beverage Innovation or legacy code participates in a core contract being audited, inspect the relevant path and record why it entered scope.

---

# 3. Non-negotiable audit rules

## 3.1 Freeze the baseline

Before analysis begins, record:

- exact commit SHA;
- branch name;
- local working-tree state;
- audit date;
- Node/package-manager versions where relevant;
- emulator/runtime configuration used for validation.

The baseline SHA is the subject of the audit.

Do not silently move to a later commit mid-audit.

If the code changes, either:

- finish the baseline report against the original SHA; or
- explicitly terminate that baseline and start a new audit baseline.

## 3.2 Baseline audit is read-only

Do **not** modify production code during the baseline forensic audit.

Allowed writes:

- reports under `docs/audits/YYYY-MM-DD/`;
- temporary audit inventory/checklists under that audit folder.

Do not:

- fix bugs while discovering them;
- refactor production code;
- alter schemas;
- alter tests to make them green;
- upgrade dependencies;
- change seeds or runtime data;
- apply formatting across source files.

Audit one stable codebase first. Remediation is a separate phase.

## 3.3 Evidence before conclusions

Every substantive finding must be supported by concrete evidence from one or more of:

- source code;
- API/schema definitions;
- configuration;
- persistence implementation;
- tests;
- build/typecheck/test output;
- reproducible runtime behaviour;
- explicit mismatch between upstream and downstream contracts.

Do not report generic software-development advice as a finding.

## 3.4 Coverage must be explicit

For every mandatory audit category, record one of:

- **Findings**
- **Inspected — no finding**
- **Not applicable — reason**
- **Blocked — missing evidence**

A silent section does not count as inspected.

## 3.5 Trace actual execution paths

Do not trust file names, labels or comments alone.

Trace:

```text
UI action
 → API route
 → validation/auth
 → domain/service command
 → persistence/event
 → projection/materialisation
 → downstream consumer
 → displayed operational state
```

Where a workflow crosses apps, follow it all the way through.

## 3.6 Do not trust old documentation blindly

Use documentation as context, not proof.

If docs and code disagree:

1. identify the conflict;
2. inspect live call paths and tests;
3. determine current actual behaviour;
4. record the discrepancy.

## 3.7 Follow nested AGENTS.md files

Before auditing a subtree, search for nested `AGENTS.md` and app-specific README/docs.

Nested instructions are additive and more specific for that subtree.

## 3.8 Never invent validation results

When commands are run, record:

- exact command;
- directory;
- outcome;
- relevant failure output.

Never claim a test/build/typecheck/E2E suite is green unless it completed successfully during the audit or the report explicitly states it is quoting a prior run rather than independently verifying it.

---

# 4. Audit report structure

Create:

```text
docs/audits/YYYY-MM-DD/
```

Recommended reports:

```text
00-baseline-and-platform-map.md
01-integration-hub.md
02-hospitality-booking-portals.md
03-hospitality-manager-dashboards.md
04-cpu-production.md
05-delivered-in.md
06-logistics.md
07-ad-hoc-production.md
08-shared-domain-contracts.md
09-cross-app-workflow-traces.md
10-auth-security.md
11-data-persistence-recovery.md
12-performance-cost.md
13-testing-ci-uat.md
14-launch-environment-config.md
15-dead-legacy-stale-code.md
FINAL-REMEDIATION-PLAN.md
```

If the actual tree requires another report, add it and explain why.

---

# 5. Finding IDs

Use stable prefixes:

```text
PLAT-###   platform / global architecture
HUB-###    Integration Hub
PORTAL-### Hospitality booking portals
MGR-###    Hospitality manager dashboards
CPU-###    CPU Production
DIN-###    Delivered-In
LOG-###    Logistics
ADH-###    Ad-Hoc Production
SHARED-### shared contracts
XAPP-###   cross-app workflow/contract
AUTH-###   auth/security
DATA-###   persistence/recovery
PERF-###   performance/cost
TEST-###   testing/CI/UAT
ENV-###    launch environment/config
LEGACY-### dead/stale/legacy risk
```

Do not renumber old findings when later findings are inserted.

---

# 6. Severity model

## P0 — launch blocker / severe operational risk

Examples:

- incorrect allergen/safety state can be presented as safe;
- authoritative operational data can be routinely lost or corrupted;
- severe cross-site authorisation failure;
- routine duplicate/missing Production or Fulfilment work;
- system reports success while critical downstream state is absent;
- destructive recovery/migration path likely during rollout.

## P1 — serious correctness/workflow defect

Examples:

- amendments or cancellations fail downstream;
- valid workflow is structurally impossible;
- stale write overwrites recent user change;
- BST/date conversion puts work on wrong day;
- retry creates duplicate work;
- important status materially misrepresents canonical state;
- one-off destination is incorrectly coerced into a governed identity.

## P2 — resilience/performance/maintainability/test risk

Examples:

- unbounded query likely to become slow/expensive;
- unnecessary broad polling/read amplification;
- operational store lacks restart/recovery safety;
- high-value failure path has no regression coverage;
- concurrency weakness with a narrower trigger;
- hidden deployment assumption likely to break outside local dev.

## P3 — cleanup/polish/lower-risk debt

Examples:

- stale docs;
- no-op controls;
- dead code;
- misleading naming;
- minor accessibility/interaction issue;
- duplicated presentation logic with no current correctness impact.

Do not inflate severity.

---

# 7. Confidence model

Each finding must include:

- **High** — demonstrated directly by code/test/runtime evidence.
- **Medium** — strong evidence with one unresolved runtime/config assumption.
- **Low** — plausible risk requiring verification.

Low-confidence items should be clearly marked as investigation items rather than stated as confirmed defects.

---

# 8. Mandatory finding format

```markdown
## CPU-017 — Concise title

**Severity:** P1  
**Confidence:** High  
**Category:** Concurrency / Data integrity

### Evidence
- `path/to/file.ts:123-156` — concise explanation.
- `path/to/other.ts:44-81` — conflicting/downstream assumption.
- Runtime/test evidence where relevant.

### Observed behaviour
Precise current behaviour.

### Expected invariant
Relevant FIKA OS/domain invariant.

### Failure scenario
1. Preconditions.
2. Action.
3. Retry/interleaving/state transition.
4. Incorrect result.

### Operational impact
What a chef, manager, driver, customer or downstream system experiences.

### Cross-app impact
Affected upstream/downstream apps/contracts, or `None identified`.

### Recommended fix direction
Smallest architectural direction that fixes the root cause. Do not implement during baseline audit.

### Regression tests required
Specific tests needed to prove remediation.

### Related findings
- `XAPP-004`, if relevant.
```

Avoid huge pasted source blocks. Use concise file/line evidence.

---

# 9. PASS 0 — Baseline and platform map

Create `00-baseline-and-platform-map.md` before app findings.

Record:

- exact SHA and branch;
- active apps;
- core shared libraries/contracts;
- legacy paths;
- persistence systems;
- event/change-feed/projection mechanisms;
- Firebase configuration/rules/indexes;
- local launcher/supervisor architecture;
- package scripts per core app;
- test/UAT tooling;
- all `AGENTS.md` files;
- authoritative vs projected data ownership.

Produce an authority/dependency map for the core apps:

| Area | Owns | Reads | Writes | Persistence | Emits | Consumes | Auth |
|---|---|---|---|---|---|---|---|

Trace the major real workflows before evaluating them.

At minimum:

```text
Hospitality Portal
 → Hospitality Manager
 → CPU Production
 → Fulfilment
 → Logistics

Ad-Hoc Production
 → CPU Production
 → Fulfilment
 → Logistics

Production/Menu-originated delivered work
 → CPU
 → Fulfilment
 → Logistics
 → Delivered-In projection
```

If another app is required to complete a trace, bring only that relevant path into scope and record it.

---

# 10. Mandatory microscopic checklist for every core app

Every core app report must explicitly cover all categories below.

## 10.1 Purpose and domain ownership

- business purpose;
- authoritative state;
- projected/read-only state;
- ownership leakage;
- duplicated domain truth.

## 10.2 Routes/screens/user entry points

Inventory meaningful:

- pages;
- tabs/views;
- create/edit/detail flows;
- modals/drawers;
- mobile-specific workflows;
- hidden/legacy routes still reachable.

Look for:

- no-op controls;
- dead links;
- duplicate routes with different logic;
- UI bypass of domain validation;
- stale/hardcoded operational content.

## 10.3 API endpoints

For every meaningful route inspect:

- HTTP method/action;
- authentication;
- authorisation/site scope;
- input validation;
- response/error shape;
- status codes;
- idempotency;
- retry behaviour;
- side effects;
- downstream calls;
- query bounds;
- information leakage.

Compare read and write scoping.

## 10.4 Domain/service layer

Inspect:

- invariants;
- lifecycle transitions;
- invalid/unreachable states;
- duplicated rules;
- hidden UI-only validation;
- error semantics;
- implicit transitions;
- command/query separation where relevant.

## 10.5 Identity

Inspect:

- stable IDs;
- display-name joins;
- canonical IDs vs generated IDs;
- occurrence identity;
- handoff identity preservation;
- one-off identities;
- sourceReference/idempotency identity.

Search explicitly for name/title/address matching across domains.

## 10.6 Versioning and immutability

Inspect:

- revisions;
- publications;
- snapshots;
- quotes/documents;
- historical allergen evidence;
- mutable vs immutable state;
- stale artifact detection;
- supersession.

## 10.7 Idempotency and duplicate prevention

Audit:

- double-clicks;
- network retries;
- repeated event consumption;
- replay after partial failure;
- handoff commands;
- document generation;
- Production/Fulfilment materialisation.

## 10.8 Amendments

Trace edit-after-handoff behaviour end to end.

Check:

- does edit become an explicit amendment?
- does it retain lineage?
- does it supersede rather than duplicate?
- are stale artifacts marked stale?
- does downstream state update exactly once?
- can concurrent stale edits win?

## 10.9 Cancellation/withdrawal

Trace cancellation before and after downstream handoff.

Check:

- reason/audit;
- propagation;
- fulfilment withdrawal;
- logistics removal/update;
- stale projection cleanup/tombstone;
- resurrection after refresh/replay.

## 10.10 Allergens and safety

Where relevant inspect:

- canonical columns;
- `UNRECORDED` vs `CLEAR`;
- contains/may-contain semantics;
- validation/readiness;
- archived snapshots;
- post-publication changes;
- stale UI fallback;
- bidirectional/current truth where applicable;
- unsupported dietary inference.

## 10.11 OPLOC and destination governance

Inspect:

- canonical OPLOC use;
- one-off address support;
- identity vs label;
- site scoping;
- logistics destination contract;
- fake OPLOC creation/coercion;
- address snapshot immutability where required.

## 10.12 Dates/time/BST

Search for:

- `toISOString().slice(0, 10)`;
- JS local-midnight conversion;
- UTC/local assumptions;
- date-only strings;
- `new Date(...)` parsing ambiguity;
- service date vs delivery datetime;
- week navigation;
- midnight/DST boundaries;
- scheduled jobs/timezones.

Validate against `Europe/London` operational behaviour.

## 10.13 Persistence and atomicity

Inspect:

- authoritative store;
- transaction/CAS usage;
- multi-write partial failure;
- uniqueness constraints;
- file/SQLite locking;
- Firestore transaction semantics;
- restart persistence;
- cache/projection authority confusion.

## 10.14 Concurrency/race conditions

Think adversarially:

- two tabs;
- two managers;
- blur-save plus publish;
- drag/drop plus refresh;
- stale projection plus mutation;
- amendment during downstream processing;
- simultaneous status change;
- repeated polling/event application.

Do not only inspect explicit mutexes; inspect asynchronous UI state and server writes.

## 10.15 Cross-app handoffs

For every handoff inspect:

- source contract;
- target contract;
- transformation;
- ID mapping;
- status mapping;
- missing/optional fields;
- idempotency;
- error recovery;
- acknowledgement semantics;
- event ordering;
- cancellation/amendment propagation.

## 10.16 Projection/cache/freshness

Inspect:

- localStorage/session cache;
- projection version/cursor;
- incremental feed;
- polling intervals;
- visibility refresh;
- immediate post-mutation refresh;
- stale cache fallback;
- deletion/tombstones;
- cursor loss/duplicate ordering;
- last-updated presentation.

## 10.17 Loading/error/empty states

Look for operationally misleading UI:

- loading shown as empty;
- failed fetch shown as zero;
- stale data shown as current;
- unknown allergen shown as clear;
- hardcoded success/status/time;
- mutation fails but UI optimistically remains successful.

## 10.18 Authentication and authorisation

Inspect separately:

- identity resolution;
- session trust;
- development synthetic users;
- role checks;
- site/OPLOC scoping;
- cross-site writes;
- server/client trust boundaries;
- service credentials/secrets;
- hardcoded staff identity.

## 10.19 Performance and metered-service cost

Use `COST-EFFICIENCY.md`.

Inspect:

- unbounded reads;
- repeated reference-data reads;
- N+1 patterns;
- polling loops;
- broad Firestore listeners;
- unnecessary writes;
- expensive page-load jobs;
- sequential cross-app waits;
- projection opportunities already present but bypassed;
- server/client caching.

Separate action latency from visibility latency.

## 10.20 Data recovery and restart safety

Inspect:

- what survives process restart;
- local emulator restore/export;
- SQLite/file store durability;
- backup path;
- deterministic seeds;
- migration reproducibility;
- operational vs reference-data confusion;
- ignored files needed for a clean deployment.

## 10.21 Tests

Inventory tests by layer:

- unit/domain;
- API/integration;
- projection;
- cross-app;
- browser/E2E;
- Golden Week UAT.

Map tests to the highest-risk invariants.

Look for:

- shared test DB contamination;
- order dependence;
- tests that assert implementation instead of business outcome;
- missing amendment/cancellation/retry/BST tests;
- tests using synthetic state impossible in production.

## 10.22 Build/typecheck/runtime

Read actual package scripts before running commands.

Inspect:

- typecheck;
- build;
- lint if meaningful;
- dev/start differences;
- Next version-specific guidance;
- environment requirements;
- warnings indicating real launch risk.

## 10.23 Dead/stale/legacy code

Identify:

- unreachable production paths;
- duplicated old flows;
- stale APIs;
- old `sites/` dependencies;
- abandoned feature flags;
- obsolete docs;
- recovery/migration code that must remain;
- old code that is dangerous precisely because it is still reachable.

Do not recommend deletion without proving it is unused or safely retired.

## 10.24 UX/operational correctness

This is not a visual redesign pass.

Inspect whether the interface causes operational mistakes:

- false status;
- false counts;
- ambiguous buttons;
- hidden required actions;
- calendar date errors;
- inconsistent terminology for the same lifecycle;
- destructive actions without adequate confirmation/context;
- mobile workflow unusable for its actual role;
- state change not visibly confirmed.

## 10.25 Accessibility/basic interaction integrity

Check practical basics:

- keyboard reachability for critical actions;
- labels for meaningful controls;
- disabled/loading state clarity;
- modal focus/escape behaviour where relevant;
- clickable non-button elements causing broken interaction;
- unreadable status reliance on colour alone.

Keep this proportional to launch risk.

---

# 11. Hospitality must be split into two audits

Do not treat Hospitality as one report.

## Booking Portals

Focus on:

- site-specific differences;
- common `BookingPortal` logic;
- catalogue/menu loading;
- draft persistence;
- quantity/business rules;
- allergens/dietaries;
- final review;
- submission/idempotency;
- site/OPLOC mapping;
- date/time handling;
- duplicate submission;
- stale menu/reference data;
- accessibility/customer error states.

## Manager Dashboards

Focus on:

- review lifecycle;
- quote generation/revisions;
- generated menus/documents;
- Drive persistence;
- allergen artifacts;
- CPU handoff;
- amendment flow;
- cancellation;
- logistics handoff/update;
- stale quote/menu detection;
- polling/freshness;
- actor/site authorisation.

Then reconcile the two in `09-cross-app-workflow-traces.md`.

---

# 12. Shared-contract audit

After individual app reports, inspect the shared contracts without respecting app boundaries.

Create `08-shared-domain-contracts.md`.

At minimum compare:

- Production creators vs Production schema;
- Production vs Fulfilment;
- Fulfilment vs Logistics;
- Logistics vs Delivered-In expectations;
- source-specific statuses vs canonical statuses;
- cancellation mapping;
- amendment/version mapping;
- OPLOC vs one-off destination;
- allergen state representation;
- actor identity;
- date/time representation;
- event/change-feed identity.

The question is:

> Can two modules each be locally correct while disagreeing about the same business object?

Search specifically for these mismatches.

---

# 13. Cross-app workflow traces

Create `09-cross-app-workflow-traces.md`.

For each representative workflow, write the actual code path and then adversarially test the lifecycle conceptually and, where safe, with existing tests/runtime.

Required traces:

### Hospitality normal path

```text
portal submit
→ manager review
→ quote
→ Send to CPU
→ CPU visibility
→ fulfilment
→ logistics planning
→ dispatch/completion
```

### Hospitality amendment

```text
already sent
→ edit booking
→ stale commercial artifacts
→ regenerate/send amendment
→ CPU updates
→ fulfilment/logistics update
```

### Hospitality cancellation after handoff

### Ad-Hoc normal path

### Ad-Hoc amendment after CPU handoff

### Ad-Hoc cancellation after CPU handoff

### Governed OPLOC delivery

### One-off-address delivery

### Delivered-In projection path

### Logistics assignment/movement/dispatch path

For each trace ask:

- what happens on retry?
- what happens on partial failure?
- what happens if destination UI is stale?
- what happens if source is amended before destination refresh?
- how is cancellation represented?
- how is identity preserved?
- what proves eventual reconciliation?

---

# 14. Whole-repo supporting scans

After app reports, perform these repo-wide scans because launch defects frequently hide outside an app folder.

## 14.1 Auth/security

Search for:

- hardcoded actors;
- dev synthetic-user fallbacks;
- APIs without auth;
- read/write scope mismatch;
- direct Firestore browser access;
- permissive rules;
- secrets in source;
- client-controlled privileged fields;
- site/OPLOC scope bypass.

## 14.2 Persistence/recovery

Inventory all authoritative runtime state and answer:

> If this machine/process/container dies, what data is lost and how is it restored?

## 14.3 Performance/cost

Search for collection-wide reads, short polling, full projection rebuilds, page-load scans and repeated stable-reference fetches.

## 14.4 Testing/CI/UAT

Determine:

- what is independently enforced;
- what relies on local manual runs;
- what Golden Week proves;
- what it does not prove;
- whether CI exists on the launch branch;
- whether parallel tests contaminate state.

## 14.5 Launch environment/config

Search explicitly for:

- `localhost`;
- fixed dev ports;
- emulator hosts;
- development project IDs;
- filesystem-relative runtime data;
- Windows-only assumptions;
- missing env examples;
- dev-only auth;
- hardcoded URLs between apps;
- production-disabled features;
- generated/ignored files required at runtime.

## 14.6 Dead/stale/legacy code

Distinguish:

- safely retained recovery/migration code;
- still-reachable legacy operational path;
- genuinely dead code;
- stale documentation.

---

# 15. Validation strategy during audit

Do not start by running every test suite.

First understand the architecture and existing tests.

Then run validation deliberately:

1. focused app unit/domain tests;
2. focused API/integration tests;
3. typecheck for core apps;
4. builds for core apps;
5. relevant browser/E2E tests;
6. Golden Week/cross-app checks where safe and reproducible.

Do not use destructive UAT reset tooling against non-local data.

Record environment prerequisites and skipped validations.

A failing test is evidence to investigate, not automatically proof of a product defect.

A passing test is not proof that an untested invariant is safe.

---

# 16. FINAL-REMEDIATION-PLAN.md

Only create the final remediation plan after all required reports are complete.

Start with an executive summary:

- baseline SHA;
- overall launch-candidate health;
- P0 count;
- P1 count;
- P2 count;
- P3 count;
- blocked audit areas;
- highest-risk cross-app contracts.

Then create a finding index.

Most importantly, group work into **coherent remediation batches**, not just severity order.

Example:

```markdown
## Batch A — Destination contract and one-off fulfilment

Fixes:
- ADH-004
- SHARED-006
- LOG-012

Why grouped:
These are different symptoms of one shared destination model mismatch.

Required validation:
- governed OPLOC E2E
- one-off address E2E
- amendment
- cancellation
- Logistics projection
```

Other likely batch themes:

- Production/Fulfilment amendment lineage;
- cancellation/tombstone semantics;
- allergen current truth vs historical evidence;
- Europe/London date handling;
- actor/auth/site scope;
- projection/change-feed correctness;
- persistence/recovery;
- launch environment configuration;
- test isolation/CI.

For each batch state:

- findings fixed;
- architectural root cause;
- intended fix direction;
- apps touched;
- migrations/data implications;
- regression suite required;
- whether another baseline re-audit is necessary.

---

# 17. Remediation phase rules

Once the baseline audit is frozen, remediation can begin.

Work **one coherent batch at a time**.

Each implementation task must:

1. read `AGENTS.md`;
2. read the relevant audit findings;
3. implement only the specified batch unless a discovered dependency makes that impossible;
4. preserve backward compatibility where required;
5. add regression tests proving the failure is gone;
6. run appropriate validation;
7. report exact files and commands;
8. update the remediation plan with completion evidence.

Do not opportunistically redesign unrelated UI or domains during remediation.

---

# 18. Re-audit after remediation

After a remediation batch that changes shared contracts, repeat the affected portions of:

- source app audit;
- target app audit;
- shared-contract audit;
- cross-app trace;
- integration/E2E validation.

Do not merely mark a finding fixed because the implementation agent says it is fixed.

Verify the invariant.

---

# 19. Audit completion criteria

The forensic audit is complete only when:

- all seven core operational areas have a report;
- all mandatory categories are explicitly covered;
- shared contracts have been reconciled;
- required cross-app lifecycle traces are complete;
- auth/security, persistence/recovery, performance/cost, testing/CI/UAT, environment/config and legacy scans are complete;
- every finding has severity, confidence and evidence;
- blocked areas are explicit;
- `FINAL-REMEDIATION-PLAN.md` exists;
- there are no unexplained `PENDING` sections.

The audit does **not** itself declare FIKA OS ready to launch.

That decision belongs to the separate **Go-Live Readiness Scan**, performed after remediation against the final release-candidate SHA.
