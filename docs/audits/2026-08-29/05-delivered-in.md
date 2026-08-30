# Delivered In — CPU Production bounded-read audi

**Audit date:** 2026-08-29
**Baseline commit:** `f750656cb1de2fd153c2ef40de42c8c4bceda23d`
**Branch:** `feature/authmod-access-control`
**Mode:** read-only forensic audit; no deployment, hosted Firestore mutation, schema change, or production-code remediation performed.

The checkout was already dirty at audit start. It contains changes across CPU Production, Integration Hub, Hospitality, Menu Planning, and new CPU cache files. Findings below describe the inspected working tree and identify upstream findings already recorded in `docs/audits/2026-08-28/firestore-read-amplification-audit.md` rather than silently treating the dirty tree as the frozen commit.

## Architecture and read-path map

```tex
Menu Planning publication
  → Integration Hub canonical Production Order
  → CPU /api/production (serviceDate or five-day week query)
  → CPU day/week projection in fikaCpuProductionDayProjectionsV1
  → Delivered In UI /allergens and DeliveredInProductionDetail
  → per-order CPU production plan in fikaCpuProductionPlansV1
  → CPU change stack / cursor and downstream fulfilment path
```

| Area | Current implementation | Persistence/read shape |
|---|---|---|
| Production-day queue | `app/page.tsx`, `app/allergens/page.tsx` | CPU projection, with canonical fallback/rebuild through Integration Hub; service-date or five-day week bounded |
| Canonical source | `lib/production-http-client.ts`, Integration Hub `lib/production-domain.ts` | `where(serviceDate == selectedDate)` or `[week, week+5)`; direct `canonicalId` detail |
| Projection | `lib/cpu-projection.ts`, `cpu-projection-repository.ts` | Direct day/week documents; change stack query by service date and sequence |
| Delivered In detail | `app/ui/DeliveredInProductionDetail.tsx` | Uses already loaded orders, then one `/api/production-plan?orderId=` request per order for review status |
| Allergen matrix | `app/allergens/page.tsx`, `AllergenReviewMatrix.tsx` | Date-scoped production load; matrix is built in memory; plans/signatures are resolved separately |
| Plan API | `app/api/production-plan/route.ts` | `GET` currently loads all plans, resolves visibility against canonical orders, then optionally resolves one plan/order |
| Plan store | `lib/production-plan-repository.ts` | Direct `doc(orderId).get()` exists, but `list()` is used by the route bootstrap |
| Destination labels | `lib/cpu-oploc-labels.ts` | Current dirty-tree code sends a bounded set of known IDs to Hub `/api/oploc-labels`; prior broad-scan finding remains recorded against the earlier baseline |
| Client cache | `app/lib/cpu-indexeddb.ts`, `app/page.tsx` | IndexedDB day/week projection keyed by `day|week:date`, authenticated server-derived `cacheScope`, schema version and sequence |
| Polling | CPU Delivered In paths | No Delivered In interval polling found. Published-menu SSE has a 25-second heartbeat and visibility/event refresh, but is a separate read-only publication view. |

## Audit coverage

### Routes and triggers

Inspected `app/page.tsx`, `app/allergens/page.tsx`, `app/ui/DeliveredInProductionDetail.tsx`, `AllergenReviewMatrix.tsx`, `app/api/production/route.ts`, `app/api/production-plan/route.ts`, the projection/repository modules, and directly called Integration Hub production/oploc paths.

- Main CPU load is automatic on view/date/week changes; it obtains an auth-derived cache scope, hydrates IndexedDB if available, then calls `changesSince` or projection load.
- Allergen load is automatic on date selection and calls `/api/production?serviceDate=...&scope=delivered_in`.
- Opening Delivered In detail triggers an automatic plan lookup for each loaded order.
- Allergen edits, planning, sign-off, and matrix persistence are user initiated. They persist one plan but also append a CPU change and rebuild the affected day and week projections.
- No Delivered In client interval or visibility polling was found. Timers are cleaned up in the separate `PublishedMenuView` SSE/visibility effect.

### Service-date and upstream scope

**Inspected — no finding:** Integration Hub `productionQueue()` uses an equality service-date query, and `productionQueueForWeek()` uses a bounded five-day range. CPU projection rebuilds use those bounded queue methods. The allergen page also applies a selected service date at the request boundary. No normal Delivered In path was found that enumerates all historical Production Orders.

Direct known-order lookup is present in `productionOrderDetail()` and `cpuPlans().doc(orderId).get()`. The plan route does not consistently use that bounded path because of the preceding collection bootstrap described below.

### Projection, cache and freshness

The projection documents and change stack are the correct architectural direction. The client cache is IndexedDB-only, schema-versioned, scoped by `runtime:project:actor.uid`, and non-authoritative; cache failure falls back to the server. This prevents cross-user hydration in the implemented keying scheme and avoids localStorage persistence for the projection.

The current implementation does not provide a true tiny head-only check: `GET /api/production?changesSince=...` returns the entire day/week projection document along with changes (`app/api/production/route.ts:190-198`). The client discards that body when the sequence is unchanged. This is one bounded document read, not a historical collection scan, but it violates the requested “unchanged data is not repeatedly fetched” target.

### Allergen, signature and mutation paths

The matrix preserves explicit allergen states and published snapshots. The normal matrix open path reads a date-scoped order set, then resolves the first order’s plan/signatures for the page and each order’s plan for detail review. Matrix edits submit one request per order; the server reads the selected plan, may read the selected canonical order, writes the selected plan, appends one change, and rebuilds only the affected service date plus its week. This is scoped by the changed order, but each rebuild rereads the bounded day/week source and plan IDs.

The durable plan audit array and CPU change event provide mutation evidence at the server boundary. The existing implementation does not demonstrate a separate duplicate audit write for reads or polls.

## Findings

## DIN-002 — Plan GET performs a full plan collection read before resolving a requested order

**Severity:** P1
**Confidence:** High
**Category:** Read amplification / Delivered In allergen state

### Evidence

- `apps/cpu-production/app/api/production-plan/route.ts:77-82` keeps a process map but `loadPlans()` calls `planRepository.list()`.
- `apps/cpu-production/lib/production-plan-repository.ts:17-20` implements `list()` as `collection().get()` over `fikaCpuProductionPlansV1`; `get(orderId)` is a direct document read.
- `apps/cpu-production/app/api/production-plan/route.ts:174-193` invokes `loadPlans()` for every GET, then checks visibility for every stored plan and may separately load the requested plan/order.

### Observed behaviour and scaling risk

Opening one allergen plan can enumerate every historical/current CPU plan, then perform additional canonical order lookups for visibility and the selected order. Plan history therefore makes a normal Delivered In GET progressively more expensive. The process map only avoids repeated work after plans have already been loaded in that process; it is not a bounded request-level guarantee and does not solve cold starts or multiple instances.

### Expected invarian

A known `orderId` should use a direct plan document read and a directly scoped visibility check. A collection-wide list should be reserved for an explicitly bounded administrative/reconciliation operation.

### Recommended fix direction

Split single-plan GET from list/notification/recovery behaviour. Resolve `orderId` through `get(orderId)` and one canonical order lookup; introduce a separately bounded status/index projection for list/notification views if required. Do not weaken CPU authorization or visibility checks.

### Regression tests required

Use a fake repository/read counter with many irrelevant plans and assert `GET ?orderId=` does not call `list()` or read unrelated order IDs. Add cold-process and repeated-request cases.

## DIN-003 — Delivered In detail creates an N+1 plan request fan-ou

**Severity:** P1
**Confidence:** High
**Category:** Allergen review read shape

### Evidence

- `apps/cpu-production/app/ui/DeliveredInProductionDetail.tsx:14` runs `Promise.all(orders.map(...))` and fetches `/api/production-plan?orderId=` once per order.
- Each request enters the collection-wide `loadPlans()` path in DIN-002 and then performs per-plan visibility/order work (`app/api/production-plan/route.ts:180-191`).
- `app/allergens/page.tsx:19` separately fetches one plan for the first day order to obtain signatures.

### Observed behaviour and scaling risk

For a Delivered In day with N destination orders, opening detail produces N plan API requests; each request can repeat the full plan collection read and canonical visibility work. The allergen page adds another plan request for signatures. The fan-out scales with destination/order count and historical plan count, even though the UI needs a small review-status projection.

### Recommended fix direction

Expose a single date/publication-day-scoped review-status read model or batch endpoint keyed by known order IDs, with direct plan reads and bounded response size. Keep full plan bodies and signature data behind a direct selected-order endpoint.

### Regression tests required

Assert one detail-open action makes one bounded request (or one request per explicitly bounded batch) and does not enumerate unrelated historical plans.

## DIN-004 — Unchanged cache revalidation fetches the full projection body

**Severity:** P2
**Confidence:** High
**Category:** Freshness/read amplification

### Evidence

- `apps/cpu-production/app/page.tsx:85-99` uses a cached projection, then calls `changesSince` on every load and returns the cached UI state if no newer sequence is found.
- `apps/cpu-production/app/api/production/route.ts:190-198` queries changes and always reads/returns the complete day/week projection document.
- `app/page.tsx:81-84` also makes a separate `cacheScope=1` request on every load.

### Observed behaviour and scaling risk

Revisiting a view, changing CPU view state, or manually refreshing while unchanged causes at least the auth/cache-scope request, a change query, and a full projection-document read. The projection read is bounded to one day/week document and does not grow with historical collections, but stable projection payloads are repeatedly transferred and decoded.

### Recommended fix direction

Return a small scoped head/sequence response, or use a version manifest already written with the projection. Only fetch the projection body when the head changes. Memoize the request-scope result for the active page load without extending authorization beyond its documented freshness boundary.

### Regression tests required

When cached sequence equals server sequence, assert no projection body endpoint/read is invoked; when it differs, assert exactly one bounded projection fetch.

## DIN-005 — Read-budget instrumentation and read-shape tests are incomplete

**Severity:** P2
**Confidence:** High
**Category:** Test/observability gap

### Evidence

- Existing tests in `apps/cpu-production/tests/cpu-indexeddb.test.ts` and `delivered-in-governance.test.ts` assert source patterns and cache properties, but do not count Firestore/repository reads.
- No `DELIVERED_IN_READ_BUDGET` implementation or broader CPU read-budget counter was found in the inspected CPU Delivered In path.
- No emulator/integration test was run in this audit.

### Observed behaviour and impac

The repository has no executable guard proving historical plan growth, detail fan-out, unchanged projection revalidation, or mutation read sets remain bounded. Static tests can pass while a route still performs broad reads.

### Recommended fix direction

During remediation, add opt-in development/test counters at repository/API boundaries. Cover cold projection load, warm unchanged load, historical cache hit/refresh, allergen matrix load, detail load, and one-plan mutation. Keep diagnostics out of business audit writes.

## Existing related finding

`DIN-001` in the 2026-08-28 audit remains the authoritative finding for the Delivered-In admission route’s canonical full scan in Integration Hub. The current CPU dirty-tree destination-label helper has moved to a bounded known-ID `/api/oploc-labels` call (`apps/cpu-production/lib/cpu-oploc-labels.ts:7`), but that does not remediate the separate Integration Hub admission path. The prior audit’s `CPU-001`/`CPU-002` findings also cover earlier canonical enrichment/projection-rebuild shapes; this report does not silently close them without a clean-baseline re-audit.

## Inspected — no finding

- Normal queue reads are explicitly service-date or five-day-week bounded in Integration Hub `production-domain.ts:193-216` and CPU’s HTTP client.
- Known canonical order and plan IDs have direct lookup functions.
- CPU day/week projections, sequence changes, and idempotent change receipts exist; projection documents are direct reads.
- No Delivered In interval polling, duplicate Delivered In timer, or hidden-tab polling was found.
- IndexedDB cache namespace includes authenticated actor/project/runtime scope and failures are non-fatal; server remains authoritative.
- Allergen data remains explicit and snapshot-aware; this audit found no read optimization that would justify changing allergen semantics.
- No new Firestore index is required by the current implementation because this audit made no code/query changes. The existing bounded production queries and change query should continue to be validated against deployed indexes during remediation.

## Remaining broad operations

- `production-plan` `list()` is currently used by normal GET bootstrap and is a confirmed hot-path defect, not an accepted recovery path.
- `GET /api/production?diagnostic=1` intentionally compares canonical bounded data with a stored projection; it is a diagnostic/reconciliation operation and should remain operator-only and out of normal UI paths.
- Projection rebuilds intentionally reread the selected day/week canonical source and direct plan IDs to materialize authoritative state. They are bounded by the selected service date/week, but should not be triggered by every unchanged read.
- Integration Hub Delivered-In admission’s canonical scan is retained as the previously recorded related finding until the shared Hub remediation is separately implemented and verified.

## Changes made

No production code, tests, schemas, indexes, or runtime data were modified during this audit. The only permitted audit artifact added is this report.

## Before / after structural assessmen

| Path | Current before/after assessment |
|---|---|
| Historical/current day queue | Historical collection scan → **bounded service-date queue plus day projection** |
| Week queue | All dates → **five-day bounded range plus week projection** |
| Projection cache | localStorage/current full reload → **IndexedDB scoped cache plus sequence check; still full projection body on unchanged check** |
| Allergen day load | All production history → **selected service-date queue** |
| Detail review status | One selected aggregate → **N per-order plan requests, each with full plan-list bootstrap** |
| Plan lookup | Direct known ID available → **broad list still precedes direct selected-plan resolution** |
| Destination labels | Prior canonical scan → **current CPU helper batches known IDs; Hub Delivered-In admission scan remains related finding** |

## Validation

Commands run:

- `npx tsx --test tests/delivered-in-governance.test.ts tests/cpu-indexeddb.test.ts tests/production-day.test.ts` in `C:\FIKA\apps\cpu-production` — **13 passed, 0 failed**.
- `npm run typecheck` in `C:\FIKA\apps\cpu-production` — **passed**.
- `git diff --check` in `C:\FIKA` — **passed**; Git emitted only pre-existing LF/CRLF conversion warnings for dirty files.

Not run: production build, emulator/integration/E2E, hosted Query Insights, or deployment. No hosted request or Firestore data mutation was performed. The focused tests are primarily contract/static/unit checks and do not prove runtime Firestore read counts.
