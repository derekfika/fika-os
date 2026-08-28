# CPU Production staging performance audit

Date: 2026-08-28  
Baseline SHA: `72dcb2844bc1427e7e8dba6e96bb94ef431ac76b`  
Branch: `feature/cpu-staging-deploy`  
Working tree: clean  
Runtime: Node `v24.14.1`, npm `11.18.0`

This is a focused CPU Production audit. It is not a full-platform forensic audit. No production code, Firestore data, AUTHMOD data, or deployment configuration was changed.

## Runtime measurement status

The generated App Hosting hostname could not be resolved from the audit environment:

```text
curl: (6) Could not resolve host: fika-cpu-production-staging--fika-os-dev.europe-west4.hosted.app
```

Consequently, warm/cold hosted timings, response payload sizes, and hosted Firestore latency are **blocked** and are not invented here. The code-path and query-count findings below are directly measurable from the current source. A browser trace or App Hosting logs is required for numeric before/after timings.

## Validation baseline

- `npm test` in `apps/cpu-production`: 73 passed, 0 failed.
- `npm run typecheck` in `apps/cpu-production`: passed.
- `git diff --check`: passed.
- The production build had passed on this same source state before this audit; no source changes were made during the audit.

## PERF-CPU-001 — Incremental week sync requires an undeclared composite index

**Severity:** P1  
**Confidence:** High

### Evidence

- `apps/cpu-production/lib/cpu-projection.ts` queries `fikaCpuProductionChangesV1` with `where("serviceDate", "==", serviceDate)`, `where("sequence", ">", after)`, and `orderBy("sequence", "asc")`.
- `listCpuWeekChanges()` runs that query once for each of five operational dates.
- `apps/integration-hub/firestore.indexes.json` contains no index for `fikaCpuProductionChangesV1`.
- The hosted browser reports HTTP 400 for `/api/production?changesSince=...`; the CPU generic error helper maps an unhandled Firestore error without an explicit status to HTTP 400.

### Observed behaviour

The browser requests incremental sync after every successful projection load. A weekly request issues five compound Firestore queries. In the current configuration the compound query has no declared composite index, so Firestore is the leading explanation for the repeated 400 response.

### Recommended fix direction

Add the exact composite index required by the query, then deploy Firestore indexes as a separate approved staging operation. After the index exists, consider replacing the five date queries with one bounded `in` query if the resulting index/query contract is verified. Do not hide the error or fall back to an unbounded collection read.

## PERF-CPU-002 — Projection hot path performs canonical Hub validation on every load

**Severity:** P2  
**Confidence:** High

### Evidence

- `apps/cpu-production/app/api/production/route.ts` enters the projection branch, reads the stored projection, then calls `productionQueue(request, ...)` before deciding whether the stored projection can be returned.
- The canonical IDs are compared against projected IDs on every projection request.
- A mismatch triggers a rebuild, which reads plans, canonical Production, OPLOCs when needed, and writes the projection.

### Observed behaviour

A normal dashboard projection read is not projection-first in latency terms: it requires a Hub Production round trip before the stored projection is accepted. This defeats the fast-read benefit whenever the Hub is slow, even when the stored projection is current.

### Recommended fix direction

Retain diagnostic reconciliation, but use event-driven invalidation plus bounded freshness metadata/TTL for the normal path. Return a known-current stored projection without a Hub call; force canonical reconciliation when the freshness bound expires, an invalidation marker is present, or an explicit diagnostic request is made. Preserve version and stale-data safeguards.

## PERF-CPU-003 — OPLOC lookup is redundant for readable destinations

**Severity:** P2  
**Confidence:** High

### Evidence

- `apps/cpu-production/lib/cpu-oploc-labels.ts` always calls `/api/oplocs` for every non-empty order collection.
- The function already distinguishes a readable `destinationLabel` from an ID-only label while mapping the result.
- `apps/cpu-production/app/api/production/route.ts` calls this helper for canonical single-order detail and projection rebuilds.

### Observed behaviour

Canonical detail normally causes two Hub calls: `/api/production?canonicalId=...` and `/api/oplocs`, even where `destinationLabel` is already populated and differs from `destinationOplocId`.

### Recommended fix direction

Skip `/api/oplocs` when no order needs label enrichment. If enrichment is needed, retain one request per server request and consider a short-lived in-process cache only after measuring label-change requirements. Do not duplicate OPLOC authority.

## PERF-CPU-004 — Card opening waits for canonical hydration before rendering

**Severity:** P2  
**Confidence:** High

### Evidence

- `apps/cpu-production/app/page.tsx` clears `selected`, sets `detailLoading`, and waits for `/api/production?canonicalId=...` before setting the selected order.
- The already-loaded projection contains the order identity, status, destination, quantities, and version needed to render useful read-only content.

### Observed behaviour

The detail panel remains blank/loading until the Hub detail request and OPLOC enrichment finish.

### Recommended fix direction

Set the projected order immediately, then hydrate canonical detail in the background. Keep canonical version authoritative for every mutation and show action loading/disabled state until hydration completes. A small cache keyed by `canonicalId + version` is safe if invalidated on projection revision changes and successful mutations.

## PERF-CPU-005 — View/navigation state can refetch an unchanged projection

**Severity:** P2  
**Confidence:** Medium

### Evidence

- The main page effect depends on `productionScope`, `view`, `dayDate`, and `weekCommencing`.
- `load()` derives the same projection key for several non-day views but still fetches whenever `view` changes.
- The page also performs an incremental request after each projection request.

### Observed behaviour

Switching between views that use the same week projection can issue another projection request and another incremental request. React production behaviour should be confirmed with a browser trace; development Strict Mode may add an additional initial effect invocation.

### Recommended fix direction

Separate projection identity (`scope + day/week key`) from presentation view. Keep the effect keyed to projection identity and explicitly refresh only when the identity changes or the user requests refresh. Preserve current view semantics.

## Firestore/read amplification inventory

| Operation | Current direct CPU Firestore work | Hub calls | Assessment |
|---|---:|---:|---|
| Warm weekly projection request | 1 projection document read | 1 canonical Production read | Unnecessary Hub validation on hot path |
| Warm day projection request | 1 projection document read | 1 canonical Production read | Same issue |
| Weekly incremental sync | 5 change queries + 1 projection read | 0 | Repeated 400 until composite index exists; five queries are avoidable after correctness is restored |
| Day incremental sync | 1 change query + 1 projection read | 0 | Requires the same composite index |
| Canonical card open | 0 direct CPU reads | 1 Production detail + 1 OPLOC list | OPLOC call is often redundant |
| Projection rebuild | projection read/write, plans read | 1 Production queue + usually 1 OPLOC list | Deliberate slow path; not suitable for every dashboard request |

No new polling loop, Firestore write, or persistent cache was introduced by this audit.

## Prioritised remediation batches

1. **Incremental sync correctness:** add/deploy the required staging index, reproduce the 400, then reduce five bounded date queries only if the query/index plan remains bounded and tested.
2. **Projection hot read:** add freshness/invalidation metadata and move canonical reconciliation to a bounded/explicit path.
3. **Detail responsiveness:** render the loaded projection immediately and hydrate canonical detail with version-safe actions.
4. **Destination enrichment:** skip readable-label OPLOC lookups and measure any short-lived cache.
5. **Presentation fetch identity:** remove view-only refetches after browser trace confirmation.

## Side-effect confirmation

- Production deployment: 0
- Firebase staging data writes: 0
- AUTHMOD writes: 0
- Menu Planning operational changes: 0
- Repository source changes: 0
