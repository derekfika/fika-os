# FIKA OS — Go-Live Readiness Scan

This document defines the **final release gate** for FIKA OS after:

1. manual UAT and snagging;
2. snag remediation and retesting;
3. the forensic codebase audit;
4. audit remediation;
5. targeted re-audit of changed contracts.

The readiness scan is not another design review and is not the place to add features.

Its purpose is to answer:

> **Can this exact release-candidate SHA be deployed and operated safely, predictably and recoverably in live FIKA use?**

Read repository-root `AGENTS.md` and the completed forensic audit reports before beginning.

---

# 1. Freeze the release candidate

Record at the top of the readiness report:

- exact Git SHA;
- branch/tag;
- scan date/time;
- auditor/agent;
- working-tree state;
- Node/npm versions;
- target Firebase/project/environment identifiers;
- target deployment/runtime model;
- apps included in the launch cohort.

No production-code changes are allowed during the readiness scan.

If a code change is required, stop, make the change in remediation mode, validate it, create a new release-candidate SHA and restart affected readiness gates.

---

# 2. Required output

Create:

```text
docs/readiness/YYYY-MM-DD-GO-LIVE-READINESS.md
```

The report must finish with exactly one release decision:

- **GO**
- **GO WITH EXPLICIT ACCEPTED RISKS**
- **NO GO**

A `GO WITH EXPLICIT ACCEPTED RISKS` decision must name each accepted risk, owner, mitigation and follow-up date/trigger.

A P0 finding can never be accepted for launch.

An unresolved P1 should normally produce `NO GO` unless there is strong evidence that the affected path is disabled/out of launch scope and cannot be reached by the launch cohort.

---

# 3. Gate A — UAT closure

Verify the current UAT/snags tracker rather than relying on memory.

Required evidence:

- launch-candidate workflows have been manually exercised;
- each launch-critical snag is closed or explicitly deferred;
- fixes have been retested;
- affected cross-app workflows were retested after fixes;
- no known UAT issue is silently absent from the release decision;
- test data is distinguishable from live data;
- any site-by-site rollout constraints are explicit.

For each unresolved snag record:

- severity;
- affected workflow/site;
- reason for deferral;
- launch impact;
- mitigation;
- owner;
- follow-up trigger/date.

---

# 4. Gate B — Forensic audit closure

Read the latest completed:

```text
docs/audits/.../FINAL-REMEDIATION-PLAN.md
```

Verify:

- all P0 findings are fixed and independently re-verified;
- launch-scope P1 findings are fixed and re-verified;
- shared-contract fixes were re-audited across both sides of the boundary;
- remediation tests prove the actual business invariant;
- no remediation batch introduced a new unresolved regression;
- blocked audit areas were resolved or explicitly excluded from launch scope with evidence.

Do not accept “implemented” as proof. Verify the current SHA.

---

# 5. Gate C — Core app validation matrix

Create a matrix for:

- Integration Hub;
- Hospitality Booking Portals;
- Hospitality Manager Dashboards;
- CPU Production;
- Delivered-In;
- Logistics;
- Ad-Hoc Production.

For each, record:

| Check | Result | Evidence |
|---|---|---|
| Typecheck | PASS/FAIL/N/A | command/output |
| Production build | PASS/FAIL/N/A | command/output |
| Unit/domain tests | PASS/FAIL/N/A | command/output |
| API/integration tests | PASS/FAIL/N/A | command/output |
| Browser/E2E | PASS/FAIL/N/A | command/output |
| Manual smoke | PASS/FAIL | scenario |

Read each app's actual package scripts before running commands. Do not invent a common monorepo command if one does not exist.

Any skipped launch-critical test requires a reason and compensating evidence.

---

# 6. Gate D — End-to-end operational journeys

Against the release candidate, prove representative end-to-end journeys.

At minimum:

## Hospitality

- portal submission;
- manager review;
- quote/document path where required;
- Send to CPU;
- CPU visibility;
- fulfilment/logistics visibility;
- amendment after handoff;
- cancellation after handoff.

## Ad-Hoc Production

- create request;
- allergen/readiness completion;
- quote/menu artifact path as applicable;
- Send to CPU;
- CPU/logistics visibility;
- amendment after handoff;
- cancellation after handoff;
- governed OPLOC destination;
- one-off address destination if in launch scope.

## CPU / Delivered-In / Logistics

- canonical production appears in correct production scope;
- correct quantities/destination/service date;
- fulfilment appears once;
- assignment/movement/dispatch works;
- Delivered-In projection shows the correct site/day information;
- cancellation/withdrawal removes or clearly marks stale downstream work;
- refresh/restart does not resurrect cancelled work.

Use Golden Week UAT where it is the correct existing whole-system fixture. Extend only when a launch-critical scenario is not represented.

---

# 7. Gate E — Allergens and safety

Where allergens are in launch scope, verify explicitly:

- `UNRECORDED` is never rendered as `CLEAR`;
- required matrices cannot be falsely considered complete;
- canonical allergen columns align across core producer/consumer paths;
- historical published/generated evidence remains immutable;
- current operational state is traceable;
- amendment behaviour is safe;
- stale allergen evidence is visible as stale rather than silently current;
- CPU/Delivered-In display cannot invent vegetarian/vegan/allergen state from missing data.

Any unresolved allergen correctness issue is a launch blocker for the affected workflow.

---

# 8. Gate F — Dates, time and BST

Test representative operational dates under `Europe/London` assumptions.

Verify:

- current week navigation;
- previous/next week navigation;
- date-only round trips;
- service dates;
- delivery dates/times;
- booking dates;
- production dates;
- logistics run dates;
- midnight boundaries;
- BST/GMT transition-sensitive helpers;
- no launch-critical path uses UTC slicing in a way that changes the UK business date.

Include at least one test around a BST-active date and, where practical, DST transition boundaries.

---

# 9. Gate G — Authentication and authorisation

Prove the live identity model rather than development shortcuts.

Verify:

- no launch-critical write path depends on a hardcoded staff actor;
- dev synthetic users are disabled/unreachable in production;
- authenticated user identity propagates to audit records;
- role/site/OPLOC authorisation is enforced on writes, not only reads/UI;
- one site cannot mutate another site's governed data without permission;
- client-controlled privileged fields are not trusted blindly;
- secrets/service credentials are server-side and absent from committed source;
- Firestore/browser trust boundaries remain appropriate.

Document any intentionally broad central-role access.

---

# 10. Gate H — Persistence and recovery

Inventory every launch-scope authoritative store.

For each answer:

- what data is authoritative?
- where is it stored?
- does it survive process restart?
- does it survive deployment restart/replacement?
- how is it backed up?
- how is it restored?
- what is the recovery point objective in practice?
- what happens after partial write failure?

Explicitly distinguish:

- Firestore live operational data;
- SQLite operational stores;
- file-backed stores;
- generated documents;
- stable reference seeds;
- cache/projections;
- localStorage/browser drafts;
- emulator/local-only recovery data.

Perform a safe recovery rehearsal for the launch-critical persistence mechanism where practical.

Do not assume local emulator export behaviour equals production backup behaviour.

---

# 11. Gate I — Reference data and clean deployment reproducibility

From a clean environment, determine whether the release has everything required to start correctly.

Verify:

- required reference data is committed or provisioned by a deterministic migration/seed;
- ignored local files are not secretly required for production;
- OPLOC/reference data has an authoritative deployment source;
- menus/catalogues needed at startup are reproducible;
- migrations are ordered/idempotent where required;
- generated files required by runtime exist or are generated deterministically;
- there is no dependence on one developer machine's filesystem state.

A clean deployment must not require copying mysterious files from `local-data/` by hand.

---

# 12. Gate J — Production environment/configuration

Search the release candidate for launch-breaking local assumptions.

Explicitly inspect:

- `localhost` URLs;
- fixed dev ports;
- emulator host variables;
- local Firebase project IDs;
- test credentials;
- Windows-only paths/commands in production paths;
- relative runtime filesystem paths;
- dev-only feature flags;
- development auth fallbacks;
- missing required env vars;
- CORS/origin assumptions;
- hardcoded app-to-app URLs;
- local Drive/test integrations;
- production-disabled endpoints.

For each required environment variable/config item, document:

- name;
- purpose;
- secret/non-secret;
- where configured;
- validation/default behaviour;
- failure mode if missing.

Fail fast is preferable to silently falling back to local/dev behaviour.

---

# 13. Gate K — Firebase and metered-service readiness

For launch-scope Firebase usage verify:

- correct production project/environment;
- Firestore rules deployed/intended;
- required indexes known;
- Admin SDK/server-side paths configured;
- queries are bounded;
- expected recurring read/write behaviour is understood;
- no accidental one-second polling/broad listener exists;
- stable reference data is sensibly cached;
- monitoring/usage visibility is available;
- test/emulator project identifiers cannot be used accidentally in live deployment.

Use `COST-EFFICIENCY.md` as the standing standard.

The goal is not zero reads/writes. The goal is deliberate, bounded operational behaviour.

---

# 14. Gate L — Performance and perceived latency

Measure representative critical actions rather than relying on subjective impressions.

For selected workflows record:

```text
T0 click/action
T1 source confirms
T2 durable store/event accepted
T3 projection/materialisation updated
T4 destination UI displays
```

At minimum measure:

- Hospitality → CPU;
- Ad-Hoc → CPU;
- Production/Fulfilment → Logistics;
- Logistics mutation → refreshed planning view;
- any Delivered-In projection path relied on operationally.

Classify latency as:

- source/API latency;
- persistence latency;
- downstream materialisation latency;
- polling/freshness delay;
- client rendering/cache delay.

Set an explicit operationally acceptable expectation for each launch-critical workflow.

Do not hide a 30-second polling delay by calling the API slow.

---

# 15. Gate M — Concurrency, duplicate and stale-state smoke tests

Exercise high-risk scenarios identified by the audit:

- double-submit;
- rapid repeated save;
- two browser tabs;
- stale version amendment;
- publish/send while another save is pending;
- repeated event/retry;
- refresh during mutation;
- cancel then refresh/reload;
- restart then reload projection.

Verify the result is either:

- safely idempotent;
- conflict-detected;
- explicitly rejected;
- deterministically reconciled.

Silent last-write-wins on safety/operational state must be understood and accepted only where genuinely harmless.

---

# 16. Gate N — Observability and supportability

For launch-critical failures, determine how they will be diagnosed.

Verify operators/developers can distinguish:

- source command failed;
- downstream materialisation failed;
- projection is stale;
- auth/permission failed;
- reference data missing;
- configuration missing;
- external API failed;
- database unavailable.

Check:

- meaningful server logs;
- audit/event records;
- error messages shown to user;
- correlation/stable IDs across a handoff;
- last-updated/freshness where operationally useful;
- recovery/retry path.

A generic “Something went wrong” with no traceable server evidence is not adequate for a critical handoff.

---

# 17. Gate O — Rollout and rollback

Document the actual launch method.

If rollout is site/OPLOC-based, verify:

- one shared platform/version remains authoritative;
- cohort/site activation is explicit;
- central CPU/Logistics dependencies are understood;
- disabled sites cannot accidentally enter a half-live workflow;
- legacy and FIKA OS authority is defined during transition;
- duplicate entry through old and new systems is prevented or reconciled.

Document rollback:

- what can be disabled?
- what code/config is rolled back?
- what happens to records already created in the new system?
- how are downstream jobs reconciled?
- how is data preserved?
- who decides rollback?

Rollback must not mean deleting live FIKA OS records and pretending they never existed.

---

# 18. Gate P — Launch-day checklist

The final readiness report must include a concise launch-day checklist covering at least:

- verified release SHA/tag;
- database/rules/index deployment;
- environment variables/secrets;
- reference-data/migrations;
- backups/recovery point;
- enabled site cohort;
- smoke test after deployment;
- first real booking/order observation;
- CPU verification;
- Logistics verification;
- support/contact owner;
- monitoring/usage check;
- rollback decision point.

---

# 19. Accepted-risk format

Any accepted launch risk must use:

```markdown
## RISK-001 — Concise title

**Severity:** P2
**Owner:** ...
**Affected scope:** ...

### Risk
...

### Why launch can proceed
Concrete evidence, not optimism.

### Mitigation during launch
...

### Trigger for rollback/escalation
...

### Required follow-up
...

### Due / trigger
...
```

Do not bury accepted risks in prose.

---

# 20. Final release decision format

End the report with:

```markdown
# Release Decision

## GO | GO WITH EXPLICIT ACCEPTED RISKS | NO GO

**Release candidate:** `<SHA>`
**Launch scope:** ...
**Decision date:** ...

### Evidence summary
- UAT: ...
- Forensic audit/remediation: ...
- Core builds/tests: ...
- E2E operational journeys: ...
- Auth/security: ...
- Persistence/recovery: ...
- Environment/config: ...
- Performance: ...
- Rollout/rollback: ...

### Blocking issues
None / list.

### Accepted risks
None / `RISK-...`.
```

The decision must be evidence-led.

The purpose of this scan is not to prove that FIKA OS is perfect. It is to prove that the release candidate is **understood, tested, recoverable and acceptably safe for the defined launch scope**.
