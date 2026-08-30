# FIKA OS Firestore Read-Amplification Audi

**Audit date:** 2026-08-28
**Baseline SHA:** `3319a9ae9fb357f2558212af6b0a0d884ee06a12`
**Branch:** `feature/authmod-access-control`
**Primary staging project in brief:** `fika-os-dev`
**Mode:** read-only forensic static audit; no hosted requests, Firestore reads, writes, deployments, migrations, merges or rebases performed.

## Executive summary

The approximately 1.3 million staging reads are not explained by one unusually large business query. They are the product of repeated authorization and reference-data work on interactive request paths.

The strongest confirmed cause is `FirestoreAuthModRepository.listActiveOplocs()`: it executes `db.collection("integrationHubCanonical").get()` and filters `entityType === "OPLOC"` in memory. Query Insights reports 543 executions and 482,727 reads, exactly consistent with 543 × 889 documents. The same pattern exists in the public `/api/oplocs` route, Delivered-In admission, CPU destination enrichment, and other canonical services.

The second confirmed cause is AUTHMOD request amplification. `resolveUserAccess()` reads an identity, all matching interactive grants, the application document, and all app assignments; scoped checks additionally read all site assignments and one canonical OPLOC document per requested site. `evaluateAuthority()` calls `resolveUserAccess()` and then rereads identity and grants, plus delegations and source-grant checks. There is no request-scoped access-context memoization.

Execution multipliers come from page/bootstrap requests and per-OPLOC loops, not only from user clicks. CPU, Hospitality and Menu Planning access routes enumerate OPLOCs and evaluate access separately. Logistics and Menu Planning middleware perform a Hub admission request for every non-static matched request. Logistics then performs its own route authorization again. The middleware matchers exclude common static resources, so static assets are not the primary confirmed multiplier, but page/API/RSC/prefetch request multiplicity remains material.

This architecture is **not safe for production from a Firestore read/cost perspective** until P0/P1 controls are implemented and measured. Authorization must remain fail-closed; the recommended reductions below preserve server-side evaluation and revocation semantics.

## Scope, evidence and limitations

Evidence inspected at the frozen baseline includes Integration Hub AUTHMOD, canonical and launcher paths; CPU Production; Logistics; Menu Planning; Hospitality Booking; Delivered-In references; Firebase indexes/configuration; package scripts; tests; and nested `AGENTS.md` guidance. The only quantitative runtime evidence supplied is the Query Insights summary in the audit brief.

The worktree was already dirty before this audit, including unrelated Hospitality and Menu Planning files. Those changes were not modified. Other worktrees were listed but not checked out, merged, rebased or altered. No production runtime test was run because the brief prohibits repeated hosted requests and collection scans. Consequently, exact per-request production traffic rates, active OPLOC count, delegation count, and the unaccounted portion of the 1.3m event cannot be proven from source alone; those values are called out as ranges/formulas rather than presented as facts.

## Baseline platform map

| Area | Authoritative state / read model | Main Firestore or external reads | Auth boundary |
|---|---|---|---|
| Integration Hub / AUTHMOD | AUTHMOD identities, assignments, grants; canonical records | bounded identity lookups plus broad assignment/grant queries; canonical records | Hub session + AUTHMOD |
| CPU Production | Production orders and CPU projections/change stack | date/order/projection reads; canonical full scan for destination labels and projection rebuild | CPU route actor or Hub/service boundary |
| Logistics | Logistics jobs, loads, runs, stops, day projection | date-bounded collections; projection and change reads; upstream Hub/CPU HTTP | middleware admission plus route access |
| Menu Planning | operational store and Firestore materialisations | SQLite operational reads; catalogue/publication reads; Hub admission and OPLOC calls | middleware plus app auth |
| Hospitality | canonical Booking workflow and Drive artifacts | booking/date queries, canonical catalogue scans in selected Hub services, Hub access | Hub access route and booking scope |
| Delivered-In | projection/consumer view | Hub canonical admission path in current route | Hub actor permission |
| Launcher | derived application list | applications plus per-app/per-site access checks | Hub session + AUTHMOD |

The canonical ownership invariant remains correct: entry workflows should hand off to canonical Production and Fulfilment, then Logistics. The problem is that several read paths bypass bounded projections and repeatedly reconstruct access/reference context.

## Exact Query Insights accounting

| Query group | Executions | Reads | Reads/execution | Confirmed interpretation |
|---|---:|---:|---:|---|
| `integrationHubCanonical` | 543 | 482,727 | 889.00 | full collection scan; 543 × 889 = 482,727 |
| `authmodAuthorityGrants` | 18,145 | 330,241 | ~18.20 | repeated subject grant queries |
| `authmodSiteAssignments` | 12,020 | 213,114 | ~17.73 | repeated identity site-assignment queries |
| `authmodAppAssignments` | 12,921 | 88,696 | ~6.86 | repeated identity app-assignment queries |
| **Four groups total** | **43,629** | **1,114,778** | — | **85.75% of a 1.3m event, approximately** |

The four supplied groups account for **1,114,778 reads**. Against the brief's approximate 1,300,000 total, approximately **185,222 reads remain unaccounted for**. They plausibly include targeted canonical queries, identity/application/ delegation reads, CPU/Menu Planning collections, audit reads and other Integration Hub queries, but this report does not attribute them without Query Insights detail.

Top offenders by total reads are canonical scans, grants, site assignments, then app assignments. By execution count they are grants, app assignments, site assignments, then canonical scans. By reads per execution the canonical scan is the worst by a wide margin.

## Runtime call-path traces

### Canonical OPLOC and access paths

```tex
CPU browser dashboard
 → CPU /api/production or /api/oplocs
 → CPU withReadableDestinations() or CPU-side proxy
 → integrationHubCanonical.get()
 → in-memory OPLOC label filtering
 → ~889 reads per full-scan execution
```

```tex
CPU / Hospitality / Menu Planning access bootstrap
 → Hub /api/{cpu-production|hospitality|menu-planning}/access
 → listActiveOplocs()
 → readAll("integrationHubCanonical")
 → per-OPLOC resolveUserAccess()
 → identity/grants/app assignments/site assignments/targeted OPLOC reads
```

```tex
Menu Planning or Logistics browser reques
 → app middleware admission reques
 → Hub /api/{menu-planning|logistics}/access?mode=admission
 → requireFikaSession()
 → resolveSessionIdentity() external identity query
 → resolveUserAccess()
 → AUTHMOD Firestore reads
 → application request proceeds
```

```tex
Launcher browser load
 → Hub /api/launcher
 → requireFikaSession()
 → buildLauncher()
 → listApplications()
 → hasAuthmodAdmin() (identity + grants)
 → per visible app: resolveUserAccess()
 → for scoped apps: getIdentity(), listSiteAssignments(), then per-site getActiveOploc()/resolveUserAccess()
```

### Confirmed source locations

- `apps/integration-hub/lib/authmod-core/firestore-repository.ts:22,44` — generic unbounded `readAll()` and `listActiveOplocs()` full canonical scan.
- `apps/integration-hub/app/api/oplocs/route.ts:7` — full canonical scan and in-memory address/OPLOC filtering.
- `apps/integration-hub/app/api/delivered-in/access/route.ts:14` — full canonical scan during Delivered-In admission.
- `apps/cpu-production/app/api/production/route.ts:248-263` — full canonical scan for readable destination labels.
- `apps/cpu-production/lib/cpu-projection.ts:32` — full canonical scan during projection rebuild/enrichment.
- `apps/integration-hub/app/api/cpu-production/access/route.ts:12-17` — unscoped app check, full OPLOC listing, then scoped check per OPLOC.
- `apps/integration-hub/app/api/hospitality/access/route.ts:12-15` — full OPLOC listing and scoped check per OPLOC.
- `apps/integration-hub/app/api/menu-planning/access/route.ts:16-34` — app check, full OPLOC listing, scoped check per OPLOC, and authority evaluation per qualifying OPLOC.
- `apps/integration-hub/lib/launcher.ts:11-27` — per-application and, for scoped apps, per-site access evaluation.

The correct future query shape for active OPLOC discovery is at minimum a bounded `where("entityType", "==", "OPLOC")` query, with lifecycle/publication predicates where index-supported, or a dedicated OPLOC read model. The existing composite index on `canonicalId + entityType` does not prove support for the desired lifecycle/publication query. Index deployment was not changed or tested in this audit.

## AUTHMOD query budge

The Query Insights averages provide a defensible baseline of approximately 18.2 grants, 6.86 app assignments and 17.73 site assignments per matching query. Document reads for single-document gets are counted as one when the document exists; missing-document billing/SDK behaviour was not runtime-verified here.

### `resolveUserAccess()` unscoped interactive evaluation

```tex
getIdentity(principal.id)                         1
listAuthorityGrants(principal.id, interactive)  ~18.2
getApplication(appId)                             1
listAppAssignments(identity.id)                  ~6.86
----------------------------------------------------
baseline                                         ~27.06 reads
```

For an OPLOC-scoped evaluation, add:

```tex
listSiteAssignments(identity.id)                ~17.73
getActiveOploc(requested OPLOC)                    1
----------------------------------------------------
scoped total                                     ~45.79 reads
```

These are direct repository reads before any route's surrounding session identity resolution or domain reads. `resolveUserAccess()` fetches all subject grants and all app assignments even when only one app/action is requested.

### `evaluateAuthority()` interactive evaluation

```tex
getApplication(appId)                             1
resolveUserAccess(...)                         ~27.06 unscoped
                                                   or ~45.79 scoped
getIdentity(principal.id)                          1
listAuthorityGrants(identity.id, interactive)  ~18.2
listDelegations(identity.id)                     D+ (D = returned delegation docs)
per effective delegation source-grant query    ~18.2 each
full-access scope OPLOC lookup                    +1 when applicable
```

Therefore the common scoped, non-delegated authority path is approximately **65.99 direct AUTHMOD/canonical reads plus delegation-query overhead** (`1 + 45.79 + 1 + 18.2 + D`). This is not a claim that every request returns exactly those document counts; it is the source-derived budget using the supplied Query Insights averages.

### Representative route budgets

| Request | Confirmed access shape | Approximate access reads, excluding domain data |
|---|---|---:|
| Login POST | external identity query; email fallback only on no external match; optional identity binding/custodian reads | 1 normally, more on fallback/binding |
| Launcher load | session identity + `listApplications`; `hasAuthmodAdmin`; per visible app, per-site loops for scoped apps | formula depends on visible apps/sites; potentially hundreds to thousands; full-access path can add one canonical full scan per scoped app |
| CPU dashboard admission | not middleware; CPU UI calls app-specific access and then production data | ~27.06 for unscoped app check; CPU access endpoint adds 889 + ~45.79 × active OPLOCs |
| CPU card detail | route actor check plus targeted order/detail reads; Hub calls depend on component path | exact count blocked without one controlled request; no global static single number |
| Logistics dashboard load | middleware Hub admission + route `requireLogisticsAccess` | two access evaluations are structurally possible: middleware and route; each ~27.06 unscoped, plus session identity lookups |
| Menu Planning dashboard load | middleware admission; app access route can perform full OPLOC/per-OPLOC checks when non-admission mode; page also calls `/api/oplocs` | admission ~27.06; full access path = 889 + per-OPLOC scoped evaluations and possible authority evaluations |
| Hospitality dashboard load | app access endpoint lists OPLOCs and evaluates each; dashboard booking/domain calls follow | 889 + ~45.79 × active OPLOCs, plus session and booking reads |
| Scoped Hospitality read | `hospitality-bookings` authorization with requested OPLOC | ~45.79, plus the route's booking/domain query |
| Cross-app canonical Production call | service or interactive route; CPU may call Hub/production and then canonical destination enrichment | path-specific; full canonical destination enrichment is +889 when orders are non-empty |

The exact count for a route containing `evaluateAuthority()` is intentionally not collapsed into a false integer because delegation cardinality and active OPLOC cardinality are not supplied by the evidence. The formulas above are the exact repository operations and the measured averages.

## Execution multipliers and middleware

The source shows no request-scoped memoization. Every new server request constructs/reuses a repository but does not reuse its fetched identity/access context. `Cache-Control: no-store` is returned by the access and launcher APIs, and client fetches commonly specify `{ cache: "no-store" }`.

Only two hosted middleware files were found:

- `apps/logistics/middleware.ts:6-34` — admission fetch for every matcher hit, followed by route-level access in `requireLogisticsAccess()`.
- `apps/menu-planning/middleware.ts:7-27` — admission fetch for every matcher hit.

Both matchers exclude `_next/static`, `_next/image`, favicon and common static extensions. This is a positive control: a full asset explosion is not confirmed. However, the matchers still cover page navigations and API/RSC/prefetch-shaped requests. Each such request can create another Hub session identity lookup and authorization evaluation. Logistics explicitly duplicates admission at the route layer.

Other confirmed multipliers:

- CPU published-menu view uses a 30-second interval and visibility refresh (`apps/cpu-production/app/ui/PublishedMenuView.tsx:30`). The SSE endpoint has a 25-second heartbeat, but heartbeat alone is not a Firestore read.
- Logistics loads the selected day, then a `changesSince` request, a seven-day `Promise.all` week load, and a 30-second visible interval (`apps/logistics/app/page.tsx:145-214`). The API's projection path reads a day projection and may reconcile/rebuild when inconsistent; the changes path reads changes plus the projection.
- Hospitality dashboard refreshes booking data on site-key changes and has a 30-second timer in the selected-site/inbox flow (`apps/hospitality-booking/app/ui/HospitalityDashboard.tsx:162-218, 298-302`). The exact callback path must be confirmed from the surrounding lines before assigning all timer calls to Firestore reads.
- Menu Planning has multiple independent bootstrap fetches for rolling menu, publications, catalogue and OPLOCs (`apps/menu-planning/app/rolling-menu-workspace.tsx:55-63`) and client-side readiness fetches. No broad polling loop was confirmed in the inspected page paths.
- CPU has a projection/change-feed design, but `withReadableDestinations()` still performs a whole canonical scan on any non-empty result, and projection rebuild code also scans canonical records.

The Query Insights execution counts are consistent with many request-level access evaluations. They do not by themselves identify the exact browser request count, because Query Insights groups do not include the browser correlation or full HTTP trace in the supplied evidence.

## Integration Hub canonical-store analysis

### Dangerous runtime reads

| Path | Classification | Reason |
|---|---|---|
| `listActiveOplocs()` | D / E when admin-only, otherwise F | whole canonical store to obtain OPLOC references for interactive bootstrap |
| `/api/oplocs` | F for normal app bootstrap | whole canonical store plus address map, `no-store` response |
| Delivered-In access route | F | whole canonical store during access/admission |
| CPU `withReadableDestinations()` | F | label enrichment rereads entire canonical store per response |
| CPU projection rebuild | C/D | rebuild may need canonical source, but should be bounded by relevant entities or a projection |
| `listLegendReferences()` | D/E | whole canonical store despite search and result limit being applied only after the read |
| governance/admin/import/service configuration scans | A/E depending on command | batch/admin workflows; not automatically a hot-path defect, but should remain bounded where possible |

The 543-query group is directly explained by `listActiveOplocs()` or an equivalent full canonical scan. The 889 average also shows that `.slice()`/`.filter()` after `.get()` does not reduce billed document reads.

## App-by-app analysis

### CPU Production — Findings

**CPU-001 — Canonical destination enrichment scans the full canonical store.**  **Severity P1; confidence High.** `apps/cpu-production/app/api/production/route.ts:248-263` reads all `integrationHubCanonical` documents merely to map destination IDs to labels. The same response can be preceded by projection/order reads. This is a hot-path +889-read multiplier for each non-empty response.

**CPU-002 — Projection rebuild has the same broad canonical dependency.**  **Severity P2; confidence High.** `apps/cpu-production/lib/cpu-projection.ts:32` scans the full canonical collection. Rebuilds are operationally meaningful, but request-triggered reconciliation can turn a read into a repeated cost spike.

**Inspected — no additional confirmed finding:** CPU has a `changesSince` path and projection documents, which are the correct shape for idle reduction, but the current label enrichment bypasses that benefit. Exact current dashboard/idle reads are blocked without controlled instrumentation or existing per-request logs.

### Logistics — Findings

**LOG-001 — Middleware and route authorization can duplicate AUTHMOD evaluation.** **Severity P1; confidence High.** `apps/logistics/middleware.ts:12-13` calls Hub admission, while `apps/logistics/lib/auth.ts:22-35` calls `requireFikaSession()` and `requireAppAccess()` again for the route. Every matched page/API request can therefore pay two server-side access paths.

**LOG-002 — Idle dashboard polling is non-zero and potentially expensive.** **Severity P1; confidence High.** `apps/logistics/app/page.tsx:210-213` calls `load(true)` every 30 seconds while visible. `load()` performs a projection request and a `changesSince` request (`:154-165`); each request passes middleware and route access in hosted mode. This is not approximately zero idle reads. It is CRITICAL if reconciliation is repeatedly triggered, but the frequency of reconciliation cannot be proven without runtime state.

**Inspected — no finding:** the Logistics store uses service-date filters for most day reads (`apps/logistics/lib/store.ts:57-75,89-99`) and maintains a day projection/change collection. That materially limits domain reads when the projection is healthy.

Hour model: 120 visible polls/hour. Each poll structurally contains two app requests; with middleware + route auth, this can create up to four Hub authorization evaluations per minute-level refresh cycle before domain reads. Exact Firestore reads/hour are `120 × (2 requests × 2 auth evaluations × ~27.06)` plus projection/change/domain reads, with additional reconciliation reads when the projection is stale.

### Menu Planning — Findings

**MENU-001 — Hosted middleware admission is request-multiplicative.** **Severity P1; confidence High.** `apps/menu-planning/middleware.ts:7-27` makes a `no-store` Hub admission request for every non-static matcher hit. The admission mode itself avoids OPLOC enumeration (`apps/integration-hub/app/api/menu-planning/access/route.ts:19-21`), which is a useful guard, but it still invokes session identity resolution and unscoped access.

**MENU-002 — OPLOC bootstrap has two broad paths.** **Severity P1; confidence High.** The workspace fetches `/api/oplocs` (`apps/menu-planning/app/rolling-menu-workspace.tsx:63`), whose Hub route scans the full canonical store, while the non-admission Hub access path also calls `listActiveOplocs()` and per-OPLOC authorization.

**Inspected — no finding:** the menu catalogue repository uses kind filters and `in` batching for selected IDs in relevant paths. Full catalogue/publication reads remain a P2 cost review area, not the dominant supplied Query Insights offender.

### Hospitality — Findings

**MGR-001 — Hospitality access bootstrap enumerates every active OPLOC and evaluates each.** **Severity P1; confidence High.** `apps/integration-hub/app/api/hospitality/access/route.ts:12-15` calls `listActiveOplocs()` and then scoped `resolveUserAccess()` per location. This directly combines the 889-read canonical scan with ~45.79-read scoped access evaluations per active OPLOC.

**MGR-002 — Dashboard refreshes are no-store and can fan out.** **Severity P2; confidence High.** `apps/hospitality-booking/app/ui/HospitalityDashboard.tsx:162-191` fetches bookings and, at most once per minute by a client ref, menu outputs; selection/version effects separately fetch menu readiness and allergen artifacts (`:266-302`). The exact Firestore count depends on selected booking count and Hub service implementation.

**Inspected — no finding:** booking list queries are date/site bounded in `hospitality-booking-service.ts:734-735`; site-scoped authorization is performed at the Hub boundary.

### Launcher — Findings

**PLAT-001 — Launcher access is an N×M authorization loop.** **Severity P1; confidence High.** `apps/integration-hub/lib/launcher.ts:11-27` checks admin status, lists applications, then resolves access independently for each visible app. Scoped apps first read identity and site assignments, and full-access people enumerate all active OPLOCs; each candidate site then triggers another access evaluation. The launcher is not a single bounded access-context read.

### Delivered-In and other significant paths

**DIN-001 — Delivered-In access route performs a canonical full scan.** **Severity P1; confidence High.** `apps/integration-hub/app/api/delivered-in/access/route.ts:10-16` scans canonical records before deriving access. Its contribution is not in the four supplied groups unless Query Insights labels it under canonical scans.

**HUB-001 — Legend/admin read models contain intentional broad reads.** **Severity P2; confidence High.** `listLegendReferences()` and `buildAuthmodAccounts()` read broad identity/canonical/access sets. These are administrative screens and may be acceptable at low frequency, but `listLegendReferences()` applies search/limit after reading all canonical records.

## Idle-read analysis

Confirmed non-zero idle sources include Logistics' 30-second visible polling and CPU published-menu 30-second refresh. Menu Planning/Logistics middleware add access reads to each periodic API request. Hospitality has a visible timer path and no-store dashboard refresh behaviour; the exact timer's downstream request is not fully proven in this report.

CPU's SSE heartbeat does not itself read Firestore, but publication-change events cause a refresh, and the refresh path may perform broad canonical enrichment. A hidden tab is generally guarded by visibility checks in the inspected timers. No evidence supports an architecture-wide zero-idle-read claim.

## Cost and usage model

Firestore reads are only one cost dimension; App Hosting/Cloud Run compute, network egress, Firebase Auth, Google APIs/Drive and logging are separate. No pricing figure is included because the brief supplied no billing region/contract assumptions and exact traffic volume is not recoverable from the four Query Insights groups alone.

The defensible current-day formula is:

```tex
known observed reads/day = 1,114,778 + unaccounted reads
                         ≈ 1,300,000 for the supplied staging even
monthly reads            = daily reads × active days
```

For any production user scenario, let `R` be measured Firestore reads per normal 8-hour user session and `U` users/day:

| Users/day | Reads/day | Reads/month at 22 workdays |
|---:|---:|---:|
| 10 | `10R` | `220R` |
| 25 | `25R` | `550R` |
| 50 | `50R` | `1,100R` |
| 100 | `100R` | `2,200R` |

The supplied event implies `R` cannot be safely calculated because the number of UAT users, sessions, page loads, idle duration and active OPLOCs is absent. Treating 1.3m as one user's session would be an unsupported and potentially misleading production forecast. Existing Query Insights/log correlation should supply those denominators before go-live.

Source-derived request budgets show why `R` can become large: one unscoped access evaluation is ~27 reads; one scoped evaluation is ~45.79 reads; one scoped authority evaluation is ~65.99 plus delegation overhead; and one canonical full scan is 889 reads at the observed average.

## Target read budgets

The proposed budgets are reasonable as guardrails, with one qualification: downstream domain reads must be included in a request budget, while durable writes and compute are tracked separately.

- Launcher warm load: target `<20` incremental authorization/reference reads after a valid request context exists; a cold fail-closed load may be higher but should remain bounded and not be N×M.
- CPU warm dashboard: target `<30` direct/downstream reads for a healthy projection, excluding deliberate card/detail fetches; no canonical full scan.
- Card detail: target `<10` additional reads for a single canonical order/detail, unless a documented artifact is requested.
- AUTHMOD app access: target low-single-digit reads; scoped access should use one bounded context plus one/tiny number of canonical existence checks.
- Idle application: approximately zero reads while idle, except an explicitly documented bounded change-feed/refresh interval. A 30-second full projection + duplicated auth loop fails this budget.

These are operational guardrails, not authorization shortcuts. Fail-closed behaviour, revocation, identity status, site scope, app scope, delegation and service-principal semantics remain mandatory.

## Recommended remediation plan (not implemented)

### P0 — eliminate runaway canonical scans from hot paths

Current: `listActiveOplocs()`, `/api/oplocs`, Delivered-In access and CPU enrichment scan all 889 canonical records.
Proposed: bounded OPLOC query/read model; targeted document reads for known IDs; dedicated immutable/reference projection for labels.
Expected reduction: approximately 889 reads per affected execution, removing the confirmed 482,727-read class if all 543 executions are covered.
Security impact: none if active/lifecycle/publication checks remain server-side.
Risk/complexity: medium; validate Firestore composite indexes and stale-label behaviour.

### P0 — instrument and cap authorization evaluation multiplicity

Current: every request rereads context; launcher/access routes loop by app/site; Logistics middleware and route both authorize.
Proposed: request-scoped memoized access context, explicit admission-vs-authority separation, and one bounded evaluation per request.
Expected reduction: removes repeated identity/grants/app/site reads within a request; likely cuts the 632,051 assignment/grant reads substantially, but exact percentage requires correlation.
Security impact: preserve server-side fail-closed evaluation and check revocation at the defined request boundary.
Risk/complexity: medium-high; delegation and full-access semantics require tests.

### P1 — consolidate access-query shape without weakening authorization

Current: all grants, app assignments and site assignments for a user are loaded for each decision.
Proposed: narrow queries by identity/app/resource/scope where schema permits, or a governed access projection with version/revocation checks.
Expected reduction: from ~18.2/~6.86/~17.73 documents per query toward the records needed for the decision.
Security impact: no client trust; retain authoritative server checks and immediate/defined revocation semantics.
Risk/complexity: high; requires index/schema and stale-version design.

### P1 — remove duplicate middleware/route admission checks

Current: Logistics admission middleware and route both authenticate/authorize.
Proposed: pass a verified server-side admission result to the route or deliberately select one authoritative boundary, without trusting browser headers.
Expected reduction: up to one complete access evaluation per matched Logistics request.
Security impact: must bind the result to the request/session and preserve fail-closed behaviour.
Risk/complexity: medium.

### P2 — replace idle polling with bounded change feeds/invalidation

Current: Logistics and CPU visible timers make repeated no-store reads.
Proposed: event/change notification with bounded fallback refresh and visibility-aware backoff.
Expected reduction: near-zero reads while no change occurs.
Security impact: no change to mutation authorization; freshness and missed-event recovery need tests.
Risk/complexity: medium.

### P2 — launcher and per-OPLOC bootstrap read models

Current: launcher checks every app/site combination independently.
Proposed: one server-computed, versioned access summary per request/session, with targeted checks for privileged actions.
Expected reduction: converts N×M evaluations into one bounded context read.
Security impact: launcher visibility is not authority; action endpoints must recheck.
Risk/complexity: medium-high.

### P3 — cost guardrails and regression telemetry

Current: timing logs exist in some paths but there is no demonstrated read budget assertion or cross-app read correlation.
Proposed: per-request query counters in tests, structured query-stage diagnostics, Query Insights alert thresholds and bounded idle-read tests.
Expected reduction: prevents recurrence rather than directly reducing existing reads.
Security impact: diagnostics must not expose tokens or sensitive payloads.
Risk/complexity: low-medium.

## Strategy assessmen

| Strategy | Expected reduction | Correctness/revocation | Recommendation |
|---|---|---|---|
| A. Request-scoped memoization | high within one HTTP request | safe if context is immutable for request and action checks remain server-side | **Recommended first** |
| B. Short-lived process cache | high across requests/instance | revocation delay and multi-instance invalidation risk | Use only with explicit TTL/revocation design |
| C. Session access snapshot | high | must version/revoke and avoid stale privilege | Conditional; not “forever per login” |
| D. Consolidated access read model | potentially very high | needs atomic/versioned projection and fail-closed fallback | Recommended after P0/P1 schema work |
| E. Narrower Firestore queries | medium-high | strongest freshness; requires correct indexes and semantics | Recommended alongside A |

AUTHMOD must remain fail-closed. No browser-supplied role/site claims, indefinite client authority, or stale snapshot that bypasses revocation is acceptable.

## Proposed implementation phases

1. Eliminate canonical full scans from hot paths and verify indexes/read-model freshness.
2. Add request-scoped AUTHMOD context reuse and remove duplicate admission evaluation.
3. Narrow access-query shape or introduce a governed versioned access projection.
4. Reduce client polling and make change-feed fallback bounded/backoff-aware.
5. Add per-request read budgets, correlation IDs, Query Insights monitoring and regression tests.

## Regression/read-budget tests

Recommend tests that use a counting repository/Firestore emulator and assert:

- active OPLOC lookup does not call collection `.get()` and returns only active, published OPLOCs;
- one request evaluates identity/grants/assignments at most once;
- `evaluateAuthority()` reuses the base context without rereading identity/grants;
- delegated authority checks source revocation and remains fail-closed;
- full-access users cannot bypass inactive/unknown OPLOCs;
- Logistics middleware plus route does not double-evaluate the same request context;
- launcher access is bounded independent of number of apps/sites;
- CPU warm projection and card detail meet budgets and never call canonical full scan;
- Logistics idle interval causes no Firestore reads when no change exists, with a bounded fallback test;
- Menu Planning and Hospitality bootstraps do not duplicate `/api/oplocs`/access reads;
- `UNRECORDED` allergens and site scoping remain unchanged;
- revocation between requests is observed within the documented freshness bound;
- all critical mutations continue to emit durable domain/audit evidence without adding audit writes to reads or polls.

## Production go/no-go

**NO-GO from a Firestore read/cost perspective at the audited baseline.** The supplied evidence already shows 1,114,778 reads in four groups, including 482,727 full canonical scans. The code contains additional equivalent scans and request-level authorization multipliers. Production approval should wait for P0/P1 remediation, controlled read-count validation, idle-read verification, Query Insights correlation, and fail-closed/revocation regression coverage.

## Required completion facts

- Reads accounted for exactly from supplied Query Insights: **1,114,778**.
- Approximate supplied total: **1,300,000**; unaccounted remainder: **~185,222**.
- Root causes: full canonical scans; repeated AUTHMOD context loads; per-app/per-OPLOC loops; duplicate Logistics admission/route checks; visible polling.
- Worst single query: `integrationHubCanonical`, **~889 reads/execution**.
- Worst execution multiplier: `authmodAuthorityGrants`, **18,145 executions**; worst broad-scan class: canonical, **543 executions × 889**.
- One normal session: exact value **not safely derivable** without user/session/request denominators; source-derived access budgets are ~27.06 unscoped, ~45.79 scoped, ~65.99 scoped authority plus delegation overhead, with additional canonical/domain reads.
- P0 fixes: remove canonical hot-path scans; add request-scoped AUTHMOD context reuse and bound duplicate evaluation.
- Expected P0/P1 reduction: at least the confirmed **482,727 canonical reads** if all 543 executions are eliminated, plus a substantial but not statically quantifiable reduction in the **632,051 assignment/grant reads**.
- Audit report path: `docs/audits/2026-08-28/firestore-read-amplification-audit.md`.
- Commit SHA: report not committed; baseline SHA is `3319a9ae9fb357f2558212af6b0a0d884ee06a12`.
- Pushed: **No**.
- Runtime/data/deployment changes: **Zero**.
