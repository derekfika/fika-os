# Menu Planning Phase 4 catalogue manifest and Allergen Checker audit

## Before state

The Phase 3 browser cache is the `fika-menu-planning` IndexedDB database. Its `menuCatalogue` store contains one raw catalogue entry per identity/origin namespace, and `cacheMetadata` stores the namespace, schema version, catalogue entries, categories, record count and cache timestamp. A valid cache is rendered immediately. The Phase 3 freshness window is 10 minutes; after that window, a background full `/api/catalogue` request is triggered. A cold or missing cache also triggers the full request. Consequently, Phase 3 revalidation downloaded the complete catalogue merely to discover whether catalogue content had changed. Cached entries include the embedded canonical `item`, including `allergenEvidence` and `mayContainReviewed`.

The Allergen Checker entry point is `app/allergens/page.tsx`, which renders `app/allergen-checker.tsx`. Before Phase 4 it called `useRollingData()`; that hook loaded the selected rolling week and also loaded the complete `/api/catalogue` response. The checker itself rendered and edited planned `RollingEntry.allergens` and `mayContainNotes`; switching week/day selected data already held by the rolling hook and did not issue a checker-specific catalogue request, but opening the checker still caused the shared full catalogue request. The server rolling read resolves referenced canonical dishes with targeted ID reads and reads publication state; the browser does not access Firestore.

## Phase 4 design

Hosted catalogue metadata is stored in the deterministic Firestore document `fikaMenuPlanningCatalogue/__manifest__` with `kind: "catalogue-manifest"` and:

```text
schemaVersion
catalogueVersion
updatedAt
dishCount
```

`GET /api/catalogue?manifest=true` reads only that document. If it does not exist yet, the server returns version zero; the first full catalogue response establishes the client cache metadata, and subsequent catalogue mutations create/update the manifest. Local mode stores the monotonically increasing version and timestamp in the existing `canonical-menu-items.json` envelope.

The server increments `catalogueVersion` only when `writeItems` detects changed canonical catalogue records. Create, promotion, merge, archive/restore and any future canonical edit routed through that repository therefore advance the manifest. The manifest write is in the same Firestore transaction as changed catalogue document writes. Unrelated rolling-week and publication mutations do not advance it.

The client stores the manifest alongside `menuCatalogue` metadata. On a warm cache it renders immediately, then performs at most one manifest check per 10-minute diagnostic/revalidation window. A matching version avoids the full catalogue request. A changed or missing version triggers one coalesced full catalogue refresh. Manifest failures preserve the valid cache and record the check time so the endpoint is not hammered. Cold cache behavior remains a full catalogue request followed by IndexedDB persistence.

The Allergen Checker now opts out of catalogue loading because its visible matrix is the planned week snapshot's explicit operational allergen state. That state is already in the cached `menuWeeks` record, and changing week/day therefore does not re-download catalogue data. Canonical allergen evidence remains present in `menuCatalogue` for planner/dish-picker consumers and is not used to overwrite planned review state. Server-side rolling commands remain authoritative for Allergen Checker writes; failed writes do not change IndexedDB catalogue data, and immutable publication snapshots are untouched.

## Read-budget expectation

After Phase 4, a warm Dish Library open may perform one manifest document read and zero catalogue document reads when the version matches. A changed version performs the manifest read plus one deliberate full catalogue refresh. Search and filter changes are local operations. A warm Allergen Checker open performs zero catalogue document reads and uses the cached week snapshot; its rolling-week path may still perform the existing selected-week, publication and targeted canonical-dish reads on the server when the week snapshot is not locally cached. No exact Firestore billing total is asserted beyond these query shapes.

Remaining deliberate broad catalogue reads are the full catalogue list endpoint on cold/version-mismatch loads and explicit duplicate review/maintenance paths. No delta sync or compiled published-week snapshot was added.
