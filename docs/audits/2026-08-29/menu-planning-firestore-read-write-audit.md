# Menu Planning Firestore Read/Write Behaviour Audit

**Audit date:** 2026-08-29  
**Baseline HEAD:** `61fc302dbcb2f8f84e89301d2fab0d1e40e3635c`  
**Branch:** `feature/authmod-access-control`  
**Mode:** diagnostic-only; no production code, schema, tests, migrations, deployment or runtime data was changed.

## 1. Executive summary

Hosted Menu Planning uses Firestore only through server-side adapters. The highest-cost confirmed path is the generic hosted transaction: every mutation reads every week, every referenced day and entry, every publication and publication-day, and the entire Menu Planning event collection before calculating a diff. The same broad transaction is also used by publication outbox replay.

The normal planner bootstrap is materially better for week content: it reads all week-summary documents, then only the selected week’s document, its day subcollection and each day’s entries. However, it still mounts a separate `/api/catalogue` request that reads the entire dish catalogue and filters in memory. The current checked-in local fixture contains 344 canonical dish records, matching the suspicious 250–350 range. The rolling-menu GET itself uses `listCatalogueEntriesForIds`, so its catalogue read is targeted; the separate planner catalogue request is not.

The likely largest Menu Planning-specific cost sources are therefore:

1. full catalogue reads from `/api/catalogue` and any fallback `listCatalogueEntries()` call;
2. full publication/event reads in `readPublications()` inside every hosted transaction;
3. all-week summary reads on every normal rolling-menu GET and mutation response;
4. adjacent-week prefetch, which can issue two additional full rolling-menu GETs;
5. publish-time reconciliation plus multiple broad transactions and outbox replay.

No exact Query Insights row can be proven from this repository alone. The 344-document catalogue query is a high-confidence shape match for `~344 reads/execution`; the broad publication/event or week aggregate reads are medium-confidence candidates for `~285`; a selected-week/targeted catalogue path is a low-to-medium-confidence candidate for `~6`, depending on populated data.

## 2. Scope and baseline

Inspected the Menu Planning app UI, routes, hosted/local operational-store adapters, canonical catalogue repository, rolling-menu and publication services, tests, fixtures, middleware, and package scripts. No nested `AGENTS.md` exists under `apps/menu-planning`.

The worktree was already dirty. Existing unrelated changes and existing untracked runtime data were preserved. The existing `docs/audits/` content was not overwritten.

Relevant hosted collections are declared in `apps/menu-planning/lib/firestore-operational-store.ts:7-9`:

| Collection | Role |
|---|---|
| `fikaMenuPlanningWeeks` | week root documents; `days` and `entries` subcollections |
| `fikaMenuPlanningPublications` | publication root documents; `days` subcollections |
| `fikaMenuPlanningEvents` | durable publication/domain events |
| `fikaMenuPlanningOutbox` | transactional outbox mirror for events |
| `fikaMenuPlanningCatalogue` | hosted canonical dish records |
| `fikaMenuPlanningArchiveMetadata` | declared but not directly read by the inspected adapter |

The local fixture has 344 canonical catalogue items and five saved sandwiches. The rolling JSON fixture is malformed/truncated in the current worktree, so a reliable current week/day/entry count cannot be derived from that file. The code contract is seven days per week, with entries varying by dataset.

## 3. User-facing workflow trace

### Open Menu Planning / open Week Planner

`apps/menu-planning/app/page.tsx` renders `WeekPlanner`, which uses `useRollingData` through the planner components. On mount, `apps/menu-planning/app/planner-data.tsx:19-20,23` performs `/api/rolling-menu`, and `:23` separately starts `/api/catalogue`. `apps/menu-planning/app/rolling-menu-workspace.tsx:55-63` also performs rolling-menu, publications, catalogue and OPLOC bootstrap requests for the workspace variant.

Normal hosted `/api/rolling-menu` (`app/api/rolling-menu/route.ts:24-53`):

```text
listWeekSummaries       = W reads (unbounded root collection query)
getWeekSnapshot         = 1 + D + E reads
listCatalogueEntriesForIds = ceil(I / 30) targeted queries, where I is distinct non-empty item IDs
readPublicationStateForWeek = P_week + PD_week reads
```

Here `W` is all week roots, `D` selected-week day documents, `E` selected-week entry documents, `I` distinct selected-week catalogue IDs, `P_week` publications for the selected week and `PD_week` their day documents. `getWeekSnapshot` uses one week document, one day collection query and one entries collection query per returned day (`firestore-operational-store.ts:22-30`).

The separate `/api/catalogue` call is `C` dish documents, where `C` is the entire hosted `kind == dish` catalogue; filtering is after the read (`canonical-menu-repository.ts:15-18`, `catalogue.ts:24-30`).

### Change selected week

`planner-data.ts:25-26` changes the URL with `history.pushState` and reloads through the hook dependency. A memory/IndexedDB week cache can avoid the full request, but a cache miss performs the same `/api/rolling-menu?weekId=...` path. A cache hit still launches background `summariesOnly` revalidation (`planner-data.ts:20-21`); that endpoint reads all `W` week roots. On a server fetch, `planner-data.ts:23` prefetches the previous and next weeks, so a first load can cause up to three rolling-menu GETs (selected plus two neighbours), each with its own `W` summary read and selected-week reads.

### Open/search/filter Saved Dishes / catalogue

`apps/menu-planning/app/catalogue-workspace.tsx:10` refetches on every query/category/usage/status state change with `/api/catalogue`. The API always calls `listCatalogueEntries()` before applying filters (`app/api/catalogue/route.ts:10-20`), so search is client-triggered but server-side filtering occurs only after a whole-catalogue Firestore query. Rapid typing is partly cancelled in the browser, but requests already accepted by the server are not deduplicated.

Opening one card is local state only (`catalogue-workspace.tsx`); there is no detail API and no additional Firestore read. The editor route submits `/api/menu` for create-item; the inspected canonical repository has no separate hosted edit-by-ID API. Any create/promote/merge operation begins with `readItems()` and therefore reads the entire hosted catalogue.

### Saved sandwiches

`app/sandwiches/page.tsx:31-38` calls `/api/sandwiches`, and save calls the same route at `:60-72`. `lib/sandwiches.ts` is explicitly file-backed and calls `assertOperationalStoreAvailable()`. In hosted staging/production it is rejected rather than backed by Firestore. Therefore saved sandwiches are not a current Firestore catalogue-read source; the local file is loaded once into a process map, and saves rewrite the file.

### Add a dish to a week / edit portions or entries

The planner sends `POST /api/rolling-menu` (`planner-data.ts:31` and workspace `:69`). Actions including `create-entry`, `update-entry`, `add-one-off-destination`, slot changes and reset call `getWeek()`/`saveSnapshot()` in `rolling-menu.ts`. In hosted mode, `saveSnapshot` invokes `updateRollingState`, whose transaction reads the complete rolling aggregate and complete publication aggregate/event stream before writing diffs. The response then calls `resolvedSnapshot(snapshot)` without a supplied catalogue in most mutation branches (`route.ts:65-104`), causing a full `listCatalogueEntries()` read (`route.ts:14-15`) even though only the changed week is returned.

### Open allergen data / publication readiness

`app/portion-planner.tsx:15-17` loads OPLOCs and, when a selected day/version changes, requests `/api/rolling-menu?...&publicationPreview=true`. The preview path adds an external Hub OPLOC request (`route.ts:43`) and still performs the selected-week, targeted catalogue and selected-week publication-state reads. `app/allergens/page.tsx` renders the same snapshot-based checker; no separate Firestore allergen collection was found. Allergen evidence is embedded in catalogue/entry/publication documents.

### Open publication state/history

`app/published-menu-history.tsx:7` calls `/api/rolling-menu/publications` without an ID. That calls `listMenuPublications()` (`publications/route.ts:14`), which calls `read()` from `menu-publication.ts`; hosted `readPublicationState()` is a transaction over the entire publication root, every publication’s `days` subcollection, and the entire event collection (`firestore-operational-store.ts:38,60-67`). This is a broad read of all unrelated weeks and all historical events. A publication-ID GET uses the same broad `getMenuPublication` read then filters by ID in memory.

### Publish / republish / amend / withdraw

Publish is `POST /api/rolling-menu`, action `publish` (`route.ts:106-117`). It performs reconciliation, Hub OPLOC lookup, publication creation, outbox replay, PDF/archive work, then constructs a large response. Details and formulas are in section 5.

Withdrawals use `/api/rolling-menu/publications` and `withdrawPublishedMenuDay/Week`; each hosted transaction has the same complete rolling/publication/event read baseline. Week withdrawal first reads the whole publication state, then performs one transaction per published day.

## 4. Broad-read inventory

| Site | Operation | Shape | Class | Cost driver |
|---|---|---|---|---|
| `canonical-menu-repository.ts:15-18` | `readItems` | whole catalogue query, JS mapping | A/E when planner bootstrap; B/C/D for catalogue maintenance | `C` dishes |
| `catalogue.ts:24-30` | normal catalogue API | delegates to whole catalogue, JS filter/sort | A | `C` dishes; repeated per filter change |
| `canonical-menu-repository.ts:42-50` | hosted `writeItems` preflight | whole catalogue query before targeted transaction | D | `C` dishes plus changed writes |
| `canonical-menu-repository.ts:207-247` | duplicate preview/merge | whole catalogue, JS fuzzy grouping | C/D | `C` dishes and pairwise CPU work |
| `firestore-operational-store.ts:21` | `listWeekSummaries` | whole week root collection | A/E | `W` weeks |
| `firestore-operational-store.ts:51-58` | `readRolling` | whole weeks, all referenced days and entries | D/E | `W + D_all + E_all` |
| `firestore-operational-store.ts:61-67` | `readPublications` | whole publications, every days subcollection, whole events | A for history; D/E for transactions | `P_all + PD_all + Ev_all` |
| `app/api/internal/menu-planning-diagnostic/route.ts:26` | direct diagnostic | whole weeks collection | F | `W` |
| `operational-store.ts:95-99` | local adapter analogues | full JSON/SQLite aggregate then JS filter | F/local only | local data size; not Firestore |

No Firestore listener, interval, timer or visibility handler was found in Menu Planning. The only automatic repeated reads are React effect/request behavior, cache revalidation and adjacent-week prefetch. Middleware also makes a no-store Hub admission request for each matched request (`apps/menu-planning/middleware.ts:7-27`); its Firestore cost is outside Menu Planning’s own collections but is part of the page request budget.

## 5. Week and publication findings

### `getWeekSnapshot`

Targeted by week root ID, then broad within that week’s day and entry subcollections. It does not read unrelated weeks, but it issues one entries query per day rather than one bounded query. Formula: `1 + D + E` document reads; query execution count is `1 + 1 + D`.

### `listWeekSummaries`

Unbounded `fikaMenuPlanningWeeks.get()`. Formula: `W` reads. It returns complete week documents, not a projection selected by date or a bounded page.

### `readRollingState` / `readRolling`

Transaction reads all week roots, all referenced days across all weeks, and all referenced entries across all weeks. Formula: `W + D_all + E_all`. This is used by every hosted `runTransaction`, including ordinary entry saves and publication writes.

### `readPublicationStateForWeek`

Targeted root query `where(sourceWeekId == weekId)` followed by one `days` subcollection read per matching publication. Formula: `P_week + PD_week`. It does not read unrelated publication roots or events.

### `readPublicationState` / `readPublications`

Unbounded publication root read, all publication-day subcollections, and unbounded event collection read. Formula: `P_all + PD_all + Ev_all`. Events are returned even where the caller only needs publication state; `readPublicationStateForWeek` deliberately returns an empty event array instead.

### Publish estimate

Let `W`, `D_all`, `E_all`, `P_all`, `PD_all`, `Ev_all` be the complete hosted aggregate sizes; `w`, `d`, `e` the selected week’s sizes; `C` the entire catalogue; `I` distinct IDs in the selected week/day; `K` catalogue records changed by reconciliation; and `N` outbox events replayed.

The observable publish route is approximately:

```text
Initial reconciliation getWeek:                  W + D_all + E_all
Reconciliation readItems:                        C
Reconciliation writeItems preflight:             C
Reconciliation write transaction getAll:          K (if records changed)
Attach-ID getWeek:                                W + D_all + E_all
Attach-ID save transaction (if changed):          W + D_all + E_all + P_all + PD_all + Ev_all
createPublishedMenuDay expected getWeek:          W + D_all + E_all
publish transaction readRolling:                  W + D_all + E_all
publish transaction readPublications:             P_all + PD_all + Ev_all
response getWeek:                                 W + D_all + E_all
response getMenuPublication:                      P_all + PD_all + Ev_all
response listWeeks:                               W
response publicationState:                        P_week + PD_week
response resolvedSnapshot catalogue fallback:     C
targeted catalogue in validation path:             ceil(I / 30), where invoked
outbox replay:                                     ~2 * N * (W + D_all + E_all + P_all + PD_all + Ev_all)
```

The `~2 * N` term reflects one transaction to claim each event and one to mark it delivered/failed (`menu-publication.ts:117-138`). If no reconciliation identity changes, omit the attach-ID transaction. If no event is due, replay still performs one broad transaction to discover that. PDF generation/Drive upload is not a Firestore read itself, but archive metadata persistence invokes the operational publication write path.

Writes are diff-based for rolling/publication documents, plus publication-day, event and outbox writes. For a first publication of one day with `q` new publication-day/event records, the direct publish transaction writes approximately: one changed week root, changed day/entry documents (normally the selected week snapshot’s changed week and any changed entries), one publication root, one publication-day document, and `q` event documents plus `q` outbox documents. Exact writes depend on diff and event destinations; they are not provable without the selected dataset. The route can add archive metadata writes and downstream CPU/Production calls.

## 6. Saved-dish catalogue findings and call-site inventory

The current canonical fixture contains 344 items. `docs/FIRESTORE-MIGRATION-2A.md` also documents “344 local canonical IDs”. This is the strongest available evidence for the suspected `~344 reads/execution` family; hosted runtime cardinality still requires Query Insights/runtime verification.

Whole-catalogue call sites:

- `app/api/catalogue/route.ts:10` → `listCatalogueEntries()` → `listCanonicalMenuItems()` → `readItems()`; normal search/filter is post-read.
- `app/planner-data.ts:14,36` → `loadCatalogue()`; one module-level promise per browser module, but it independently loads the whole catalogue from the planner.
- `app/rolling-menu-workspace.tsx:62` → direct `/api/catalogue`; separate whole-catalogue request from the workspace.
- `app/review/page.tsx:14` → direct `/api/catalogue`; review page whole-catalogue request.
- `app/api/catalogue?duplicates=preview` → `previewSimilarCanonicalItems()` → whole catalogue.
- `canonical-menu-repository.ts:42` → hosted mutation preflight whole catalogue.
- `createCanonicalMenuItem`, `promoteSourceCandidate`, `syncRollingEntries`, `mergeSimilarCanonicalItems` all begin with `readItems()`; these are mutation/maintenance paths, not normal week reads.
- `app/api/rolling-menu/route.ts:15` → `resolvedSnapshot` falls back to `listCatalogueEntries()` for most POST response branches and therefore rereads all dishes after a mutation.

Targeted catalogue call sites:

- `app/api/rolling-menu/route.ts:48` → `listCatalogueEntriesForIds(snapshot.entries.map(...))`.
- `canonical-menu-repository.ts:68-74` → hosted `kind == dish` plus `id in` chunks of 30. Expected reads are the matching documents returned, with up to `ceil(I/30)` query executions; Firestore billing is per returned document, subject to normal query billing semantics.

Answers to the requested specific questions: opening the planner does automatically load all dishes because of the independent catalogue effect; changing week does not rerun that effect, but the module promise is global to the loaded browser module; opening Dish Library loads all dishes; search/filter repeats a whole-catalogue read; opening one dish is local-only; editing/creating a dish reads all dishes first; adding/editing a week entry does not need the catalogue for the command but its POST response often falls back to a whole catalogue read; publish reconciliation explicitly reads/writes the whole catalogue, while the subsequent normal response also falls back to a whole catalogue read. The rolling-menu GET’s own catalogue resolution is targeted.

## 7. Background/refetch findings

**Inspected — no timer/visibility polling finding.** No `setInterval`, `visibilitychange`, focus listener or automatic Firestore listener exists in the inspected Menu Planning app. `setTimeout` is only used for transient UI messages/popover scheduling.

**Confirmed repeated-read behavior:**

- first uncached planner load can request selected week plus adjacent weeks (`planner-data.ts:23`);
- cached week load performs `summariesOnly` revalidation (`planner-data.ts:20-21`), reading all `W` week roots;
- any query/category/status keystroke or filter change on Dish Library calls `/api/catalogue` again (`catalogue-workspace.tsx:10`);
- route remounts and separate planner/workspace components can each run their own catalogue effect;
- publication readiness refetches on week/day/version/readiness state changes (`portion-planner.tsx:17`);
- page/API/RSC requests pass through Menu Planning middleware and make no-store Hub admission requests, adding cross-app authorization reads.

Therefore leaving a single stable planner tab open does not itself create a periodic Menu Planning Firestore loop, but navigation, route remounts, readiness state changes, cache revalidation and user filtering can repeatedly execute expensive reads.

## 8. Likely Query Insights mapping

| Query Insights family | Candidate | Confidence | Reason |
|---|---|---|---|
| `~344 reads/execution` | hosted `fikaMenuPlanningCatalogue.where(kind == dish).get()` from `/api/catalogue`/`readItems` | HIGH for shape, MEDIUM for exact current hosted cardinality | local fixture and migration doc both state 344; query returns all dish docs and filters later |
| `~285 reads/execution` | `readPublications` or `readRolling` aggregate transaction | MEDIUM | both can return a few hundred documents when historical publications/events or weeks/days/entries have that cardinality; exact collection/cardinality is not in code |
| `~285 reads/execution` | planner bootstrap aggregate (`W + 1 + D + E + P_week + PD_week`) | LOW–MEDIUM | plausible only for a populated selected week plus many week summaries; no reliable current fixture count |
| `~6 reads/execution` | targeted `listCatalogueEntriesForIds` or selected-week publication/day reads | LOW–MEDIUM | query is bounded by selected references and can be small, but exact returned document count depends on the active week |

These are query-shape hypotheses, not exact attribution. Query Insights collection/query identifiers and a controlled hosted trace are required to confirm the rows.

## 9. Existing protections not to disturb

- Firestore client construction is server-side; browser code calls API routes only.
- Hosted/local store selection rejects SQLite in staging/production (`hosted-runtime.ts`).
- `runTransaction` uses optimistic version checking when an expected week version is supplied (`firestore-operational-store.ts:39-46`).
- Rolling writes are diff-based rather than blind full collection rewrites.
- Publication days are immutable; changed existing publication days raise `ExpectedVersionConflict` (`firestore-operational-store.ts:78-85`).
- Durable publication/domain events and outbox records are written through the transaction path.
- Delivered events cannot be rewound to a non-delivered state.
- Catalogue reads do not perform reconciliation; reconciliation is explicit and scoped to the selected day during publish (`catalogue.ts`, `route.ts:109-113`).
- Allergen evidence and publication snapshots are retained in domain records; unknown/unrecorded safety state must not be collapsed into clear.

## 10. Prioritised Phase 2 targets (not implemented)

**P0 — measure and bound the publish transaction.** Instrument a representative hosted publish with read/write counts and isolate outbox replay cost. The current full rolling/publication/event transaction can scale with unrelated historical data and is the largest correctness-sensitive cost surface.

**P1 — remove whole-catalogue reads from hot planner paths.** Make planner bootstrap reuse the already-targeted selected-week IDs or a deliberately bounded catalogue read; stop the independent full `/api/catalogue` fetch from being required for normal week loading. Preserve stable IDs and allergen evidence.

**P1 — split publication/history reads from the transaction aggregate.** Keep immutable publication and event/outbox protections, but avoid loading unrelated publications/events for ordinary week edits. The existing `readPublicationStateForWeek` demonstrates a bounded shape.

**P1 — bound week-summary and adjacent-week work.** Evaluate a small summary projection/date window and make neighbour prefetch deliberate/measured. Do not trade this for unbounded polling.

**P2 — catalogue UX/query strategy.** Add server-side search/pagination or a versioned client catalogue cache in a later phase, with explicit unknown/allergen semantics and invalidation rules.

**P2 — mutation response slimming.** Avoid response-time whole-catalogue fallback after ordinary entry mutations; return only the changed week and targeted referenced dishes where contract-compatible.

## 11. Tests added/changed

None. The task is diagnostic-only, and the existing `apps/menu-planning/tests/read-paths.test.ts` already asserts that normal rolling GET uses `listCatalogueEntriesForIds`, targeted publication reads, week summaries and cache/revalidation hooks. No test was rewritten to accommodate current behavior.

## 12. Validation performed

Read-only validation performed:

- baseline branch, HEAD, worktree status, Node and npm versions;
- complete Menu Planning file inventory and nested-guidance search;
- static Firestore call-site search across `apps/menu-planning`;
- inspection of all relevant routes, UI fetch/effect paths, repositories and tests;
- fixture inspection: canonical catalogue contains 344 items; saved-sandwich fixture contains five records;
- package script inspection from `apps/menu-planning/package.json`.

Results:

- `npm test` from `apps/menu-planning`: passed, 58 tests / 58 passed.
- `npm run typecheck` from `apps/menu-planning`: passed.
- `npm run build` from `apps/menu-planning`: passed. Existing warnings reported: deprecated `middleware` convention and an NFT tracing warning involving dynamic filesystem access in `next.config.ts` → `lib/menu-publication.ts`.

Not run: hosted Firestore/runtime Query Insights validation, because this task is a static diagnostic baseline and no hosted request or collection scan was authorized. The malformed/truncated local rolling JSON was not repaired. No production behavior was intentionally changed.

## 13. Completion metadata

- **Branch:** `feature/authmod-access-control`
- **Starting HEAD:** `61fc302dbcb2f8f84e89301d2fab0d1e40e3635c`
- **Final HEAD:** unchanged at `61fc302dbcb2f8f84e89301d2fab0d1e40e3635c`
- **Changed files by this audit:** `docs/audits/2026-08-29/menu-planning-firestore-read-write-audit.md` only
- **Production behavior:** not intentionally changed
