# Delivered In — remaining read paths, cache and version-gating audi

**Audit date:** 2026-08-29
**Baseline commit:** `f750656cb1de2fd153c2ef40de42c8c4bceda23d`
**Branch:** `feature/authmod-access-control`
**Mode:** read-only continuation audit; no deployment, hosted Firestore mutation, schema change, or production-code remediation performed.

The checkout remains dirty with the prior DIN-002/DIN-003 remediation and unrelated pre-existing worktree changes. This report audits the current tree and does not redo or silently close those remediations.

## Executive summary

The Delivered In detail review-status path is now bounded to one deduplicated request of at most 100 known order IDs and does not call `planRepository.list()`. It runs only when the detail component’s `orders` input changes; no Delivered In interval, focus refresh, or hidden-tab polling was found.

Three remaining issues matter before deployment:

1. The full-screen allergen matrix still hydrates every selected order with one full-plan request per order. These are now direct plan reads, so historical plan count no longer multiplies each request, but the request count still scales with displayed orders and duplicates the detail review-status load.
2. Every `POST /api/production-plan` still calls `loadPlans()` first. That performs a full `fikaCpuProductionPlansV1` collection read before the command’s direct selected-plan lookup. One-order allergen edits therefore still scan all historical plans.
3. A matrix save and, when all rows are checked, mark-planned submit two separate batches of one mutation per order. Each mutation repeats the broad POST bootstrap and triggers its own change/projection rebuild sequence.

The existing CPU projection cache is identity-scoped IndexedDB and the queue source is service-date/five-day bounded. However, review status has no persistent version/head gate, and the existing `changesSince` path still returns the full projection body on an unchanged sequence as recorded in DIN-004.

## Runtime architecture and request shape

```tex
CPU Delivered In dashboard
  → /api/production?cacheScope=1
  → IndexedDB day/week projection lookup
  → warm: /api/production?changesSince=...
  → cold: /api/production?projection=1&serviceDate|weekCommencing=...

Allergen page
  → /api/production?serviceDate=...&scope=delivered_in
  → one /api/production-plan?orderId=... for signatures
  → one /api/production-plan?orderId=... per matrix order for full plan hydration

Delivered In detail drawer
  → one /api/production-plan?reviewStatus=1&orderIds=...

Matrix save/sign
  → one POST /api/production-plan per selected order
  → each POST broad-loads all plans, then direct-loads the selected plan
  → each successful order mutation appends a change and rebuilds day + week projections
```

### Review-status batch lifecycle

`DeliveredInProductionDetail.tsx:14` has a `useEffect` dependent on `orders`. It deduplicates the order IDs and performs one batch request when the detail mounts or when the parent supplies a different order array. It is not called on each render, has no interval, and is not wired to visibility/focus. A parent refresh that replaces `orders` can trigger it again; a detail close/reopen also remounts it and triggers another batch. The normal cap is 100 IDs, and the server performs at most one direct plan read per visible known order.

The batch response contains only `orderId`, `planStatus`, `reviewed`, completed source-line IDs, signature roles and optional matrix status. Missing or unavailable orders are omitted; a visible order with no plan receives pending draft status. The server resolves canonical orders before plan reads and excludes the existing `hospitality_booking`/`requiresDelivery === false` case.

### Idle/open behaviour

There is no Delivered In polling loop. The main CPU page reloads on view/date/week changes and manual refresh, not on a timer. A warm load performs a cache-scope request, IndexedDB lookup, then a `changesSince` request; the unchanged response still includes the full projection document. The allergen page loads again when its selected date changes. The matrix’s hydration effect runs when `rows` or `orders` changes, and the signature effect runs when `dayOrders` changes.

## Remaining findings

## DIN-006 — Full allergen matrix still performs an order-scaled full-plan fan-ou

**Severity:** P2
**Confidence:** High
**Category:** Allergen matrix read amplification

### Evidence

- `apps/cpu-production/app/ui/AllergenReviewMatrix.tsx:23-53` hydrates with `Promise.all(orders.map(...))`.
- Each iteration calls `/api/production-plan?orderId=...` and consumes full `plan.menuItems` and sub-item allergen data at lines 28-38.
- `apps/cpu-production/app/allergens/page.tsx:19` separately loads the first order’s full plan to obtain signatures.

### Observed behaviour

Opening the full Delivered In matrix causes one selected-order full-plan request per displayed order, plus a separate first-order plan request for signatures. The DIN-002 fix makes each request direct rather than collection-wide, but the matrix still transfers and decodes full plan bodies when it only needs the saved allergen cells and completion state. The same selected-day order data is already present in the page.

### Scaling risk

Read/request count grows with the number of displayed destination orders. Reopening the matrix or replacing the selected-day `orders` array repeats the fan-out. It does not grow with historical plan count after DIN-002, but it remains an N+1 API pattern and can duplicate the detail batch work.

### Recommended fix direction

Add a single bounded matrix hydration endpoint keyed by the already loaded order IDs, or extend the review-status batch with the minimum saved allergen-cell payload required by the matrix. Keep full plan bodies behind the existing single-order endpoint. Preserve snapshot fallback, explicit allergen states and line identity mapping.

### Regression tests required

Assert one matrix open produces one bounded request, no unrelated order IDs are read, and the returned minimal payload reconstructs saved allergen state and checked rows correctly.

## DIN-007 — Plan mutations still scan the entire plan collection before selected-order work

**Severity:** P1
**Confidence:** High
**Category:** Mutation read amplification

### Evidence

- `apps/cpu-production/app/api/production-plan/route.ts:209-217` calls `await loadPlans()` at the start of every POST before parsing and executing the selected command.
- `apps/cpu-production/app/api/production-plan/route.ts:80-82` defines `loadPlans()` using `planRepository.list()`.
- `apps/cpu-production/lib/production-plan-repository.ts:17-20` implements `list()` as `fikaCpuProductionPlansV1` collection `.get()`.
- The same POST later calls `getPlan(request, command.orderId)` at `route.ts:217`, which has a direct order-ID path.

### Observed behaviour

Saving one allergen plan, marking it planned, accepting/rejecting/clarifying it, signing it, or saving its matrix first reads every stored plan, then resolves the selected plan. The process map can hide repeated reads only after a warm instance has loaded the collection; it does not bound cold processes or multiple instances.

### Scaling risk

Every single-order mutation becomes progressively more expensive as historical plan documents accumulate. This is independent of the number of orders currently displayed and remains a direct deployment blocker for the plan-review mutation path.

### Expected invarian

A selected-order mutation should read only the selected plan aggregate, the selected canonical order and the minimum scoped projection state needed for its downstream update. Collection-wide listing belongs only to an explicit bounded list/reconciliation operation.

### Recommended fix direction

Move command parsing and selected-order loading ahead of any list-only work. For POST commands use direct `getPlan` and selected-order visibility. If list notifications are needed after a mutation, use a bounded status projection or an explicitly separate list operation; do not preload all plans.

### Regression tests required

Use a cold fake repository with hundreds of irrelevant plans and assert every one-order mutation calls `get(orderId)` only, never `list()`, and does not load unrelated canonical orders.

## DIN-008 — Matrix save and mark-planned operations multiply broad mutation work

**Severity:** P1
**Confidence:** High
**Category:** Mutation fan-out / projection rebuild amplification

### Evidence

- `apps/cpu-production/app/ui/AllergenReviewMatrix.tsx:55-57` posts `save-plan` once per order, then posts `mark-planned` once per order when all rows are checked.
- `apps/cpu-production/app/api/production-plan/route.ts:301-307` appends a CPU change and rebuilds the affected day and week for each successful POST.
- Each POST also performs the broad `loadPlans()` bootstrap described in DIN-007.

### Observed behaviour and scaling risk

For N selected orders, a final matrix action can produce N plan saves plus N mark-planned commands. Each command independently reads the full plan collection under the current implementation and independently performs day/week projection materialisation. The work scales with displayed order count and can create repeated writes/rebuilds for the same service date/week.

### Recommended fix direction

First remove the broad POST bootstrap via DIN-007. Then, if runtime measurements show this remains material, use a bounded batch mutation or coalesced projection invalidation while preserving per-order optimistic concurrency, audit evidence, idempotency and partial-failure semantics. Do not merge plans into a new authoritative aggregate without a domain decision.

### Regression tests required

Assert one-order save does not rebuild unrelated dates/orders. Add a multi-order matrix test that verifies bounded command count and defined partial-failure behaviour.

## Carry-forward findings

- **DIN-004** remains open: warm projection revalidation reads and returns the full projection body even when `lastChangeSequence` is unchanged (`app/api/production/route.ts:190-198`).
- **DIN-005** remains open: no executable Delivered In Firestore/read-budget counter proves runtime bounds.
- **DIN-001** remains open in the related 2026-08-28 audit: Integration Hub Delivered-In admission still uses the canonical full-scan path. CPU’s current known-ID destination-label helper does not fix that separate admission route.

## IndexedDB and version gating assessmen

CPU already has an IndexedDB projection cache in `app/lib/cpu-indexeddb.ts`. It is keyed by day/week plus date and validated against a server-derived runtime/project/actor scope and schema version. Cache failures fall back safely to the server. This is suitable for historical projection hydration and does not expose one user’s projection to another through the implemented scope key.

The cache does not currently store Delivered In review-status or matrix state. No compact service-date review head is exposed. Existing CPU change sequences are available for projection changes, but the client’s warm path still retrieves the projection body with the head check. Therefore:

- dashboard warm unchanged: IndexedDB render, then bounded change query plus full projection document response;
- review-status warm unchanged: no persistent cache/head gate; one batch request and direct plan reads on each detail mount/orders replacement;
- matrix warm unchanged: no persistent cache/head gate; full-plan fan-out on each matrix hydration effect;
- historical navigation: projection cache can render a matching day/week immediately, but review-plan bodies are not cached and are fetched again when the matrix opens.

A review-status head/cache change would require a deliberate cache key containing authenticated identity/access context, relevant OPLOC/domain scope and service date. No such production change was made in this audit.

## Allergen correctness and auditability

The inspected paths preserve explicit `clear`, `contains` and `may_contain` states, published allergen snapshots, source-line identity and signature roles. No missing state was treated as clear. Plan audit entries and CPU change events are written at the server boundary for meaningful mutations. No additional audit write is created for reads or cache hits.

## Upstream reconciliation and Logistics

Delivered In production orders are received through the canonical Integration Hub Production Order path. CPU requests are bounded by selected service date or a five-day week, and direct detail reads use `canonicalId`. No normal Delivered In path was found that loads complete historical Hospitality order history to discover current work. Logistics handoff is not authored by the inspected Delivered In plan-review UI; it remains downstream of canonical Production/Fulfilment contracts and is outside this focused lane.

## Indexes

No new Firestore index is required by this continuation audit because no production query/schema was changed. Existing service-date and change-sequence queries should continue to be validated against deployed indexes during remediation. The direct plan document reads require no custom index.

## Remaining broad operations

- `production-plan` `GET` without `orderId` intentionally supports list/notification/menu views and still uses collection listing; it must remain separate from the single-order path.
- `GET /api/production?diagnostic=1` intentionally performs bounded source/projection comparison and is a recovery/diagnostic path, not normal Delivered In loading.
- Projection rebuilds reread the selected service date/week and direct plan IDs; they are bounded but currently repeated once per plan mutation in DIN-008.
- Integration Hub Delivered-In admission’s canonical scan remains the related DIN-001 finding.

## Changes made

No production code, tests, schemas, indexes, or runtime data were modified during this continuation audit. This report is the only audit artifact added.

## Validation

Commands independently run against the inspected tree:

- `npm test` in `C:\FIKA\apps\cpu-production` — **84 passed, 0 failed**.
- `npm run typecheck` in `C:\FIKA\apps\cpu-production` — **passed**.
- `npm run build` in `C:\FIKA\apps\cpu-production` — **passed**; Next compiled, ran TypeScript, generated 17 static pages, finalized optimization and collected build traces.
- `git diff --check` in `C:\FIKA` — **passed**; Git emitted only existing LF/CRLF conversion warnings for dirty files.

No hosted request, Firestore data mutation or deployment was performed.

The existing validation is not sufficient to close DIN-006–DIN-008: it does not instrument actual repository read counts for matrix hydration or plan POST mutations. Those regression tests and a runtime read budget remain required before deployment.
