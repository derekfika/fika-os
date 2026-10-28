# Hospitality Rotations v1 — foundation and Luna handoff

Date: 2026-10-28. Provider: Integration Hub. Status: foundation implementation; no live provisioning, migration, merge or deployment.

## Inspection and ownership

Baseline `origin/main`: `c07caa822a6363803ce6331435ec1556673bcf1a`.
PR #98 (`codex/menu-spellcheck-week-planner`, inspected head `85199dcf881fe23bbd770f2f2e2e58ed5c858163`) remains unmerged. Its active replacement lease is `menu-spellcheck-continue`, owner `claude-menu-spellcheck`, covering all Menu Planning. No source from that PR is absorbed here.
The other active Hub lease at inspection was `adhoc-launcher-config` (App Hosting YAML and its build-config test only); no shared-package lease was active. Delivered-In also had a separate active lease. This task leases only the new shared contract, new Hub rotation modules/routes/tests and this document. It does not lease Hospitality UI.

Current authorities traced:

| Boundary | Current implementation | Rotation use |
|---|---|---|
| Dish identity/recipe revision | `apps/menu-planning/lib/domain.ts`, `canonical-menu-repository.ts`; hosted `fikaMenuPlanningCatalogue/{canonicalId}`, `kind: dish`, `record: MenuItem` | Read known IDs in publication transaction; require exact `record.revision`, reject archived/missing dishes. No sibling-app imports/writes. |
| Recipe history | `canonical-menu-repository.ts`, `store.ts` revise recipes and increment `MenuItem.revision`; catalogue is mutable current authority | Freeze complete referenced provider records as publication evidence. Do not assume a historical recipe lookup API exists. Unknown/allergen evidence is preserved verbatim. |
| Hospitality catalogue | `hospitality-catalogue-admin.ts`, `hospitality-effective-offering.ts`; `integrationHubCanonical/{stableDocumentId(ItemId)}` | Require canonical `Hospitality Menu Item` and reject archived/withdrawn records. No new Items, Prices or Offerings. |
| AUTHMOD | `fika-session.ts`, `authmod-core/evaluator.ts`, `firestore-repository.ts`; special grants use existing accounts/actions API | Special resource distinct from normal Hospitality app permissions. Current request must be authorised, including replay. |
| Booking authority | `hospitality-booking-service.ts`, `hospitality-price-trust.ts`, `schemas.ts` | Future transaction must freeze and retain the reference defined below. Existing bookings are untouched. |
| Production/CPU | `production-domain.ts` `createProductionFromApprovedBooking`, `ProductionLine`; CPU canonical order materialisation | Future dish-level expansion must extend existing canonical handoff, quantities and amendment lifecycle; this foundation creates no demand. |

## Stable contract for Luna

Authoritative runtime schemas and TypeScript types: `apps/shared/hospitality-rotations.ts`.
Import this file using the consumer's repository-relative shared import convention. Do not copy types into the dashboard or import Hub server modules into Hospitality. Zod schemas are strict: unknown keys fail. Version token is the **company aggregate** version, shared by all groups and seasons.

The initial cycle defaults to six weeks. The operator must choose the real anchor Monday; no live anchor or category data is seeded. All groups have precisely one schedule entry per global week. Neither sites nor groups have independent anchors/cycle lengths. Seasonal configurations replace the entire company configuration on their activation date. Preserve the calendar fields when preparing a normal new season; changing them deliberately changes the company's clock for all groups together. Dates before the anchor use positive modulo. Date arithmetic uses calendar-day UTC ordinals after validation, never elapsed London hours; conversion from an instant uses `londonDate` and explicit `Europe/London`.

Configuration JSON (one group shown; the five initial category labels are a suggested initial configuration, never a fixed taxonomy):

```json
{
  "schema": "hospitality-rotations.v1",
  "label": "Autumn version",
  "calendar": { "anchorMonday": "2026-10-26", "cycleWeeks": 6, "timeZone": "Europe/London" },
  "categories": [
    { "id": "finger-food", "label": "Finger Food" },
    { "id": "canapes", "label": "Canapés" },
    { "id": "bowl-food", "label": "Bowl Food" },
    { "id": "salad-proteins", "label": "Salad Proteins" },
    { "id": "salad-boxes", "label": "Salad Boxes" }
  ],
  "groups": [{
    "id": "finger", "label": "Finger Food", "categoryId": "finger-food",
    "itemId": "hospitality-menu-item:EXAMPLE",
    "dishBank": [
      { "dishId": "menu-item:EXAMPLE-1", "recipeRevision": 1 },
      { "dishId": "menu-item:EXAMPLE-2", "recipeRevision": 1 },
      { "dishId": "menu-item:EXAMPLE-3", "recipeRevision": 1 }
    ],
    "weeks": [
      { "week": 1, "dishIds": ["menu-item:EXAMPLE-1", "menu-item:EXAMPLE-2", "menu-item:EXAMPLE-3"] },
      { "week": 2, "dishIds": ["menu-item:EXAMPLE-1", "menu-item:EXAMPLE-2", "menu-item:EXAMPLE-3"] },
      { "week": 3, "dishIds": ["menu-item:EXAMPLE-1", "menu-item:EXAMPLE-2", "menu-item:EXAMPLE-3"] },
      { "week": 4, "dishIds": ["menu-item:EXAMPLE-1", "menu-item:EXAMPLE-2", "menu-item:EXAMPLE-3"] },
      { "week": 5, "dishIds": ["menu-item:EXAMPLE-1", "menu-item:EXAMPLE-2", "menu-item:EXAMPLE-3"] },
      { "week": 6, "dishIds": ["menu-item:EXAMPLE-1", "menu-item:EXAMPLE-2", "menu-item:EXAMPLE-3"] }
    ],
    "rules": {
      "guests": { "minimum": 6, "maximum": 120, "increment": 1 },
      "distinctDishes": { "minimum": 3, "maximum": 3 },
      "quantityPerDish": { "minimum": 6, "maximum": 60, "increment": 6 },
      "unit": "pieces"
    }
  }]
}
```

IDs match `[A-Za-z0-9:_-]+`, maximum 160 characters. Categories and groups have stable distinct IDs. Each group maps to one distinct canonical Item; sharing a group across Items is not represented. Every week selects distinct members of its bank and must satisfy the minimum dish count. Rules have finite positive minimum/maximum/increment, maximum >= minimum; increments are measured from minimum. Distinct dish limits are positive integers. Quantities are total per selected dish, with the unit supplied by configuration; no implicit guest multiplication. The example limits are editable data. No global catalogue price/notice/minimum rules are overridden by rotation rules.

Limits: 50 categories, 30 groups, 100 bank members/group, 150 distinct canonical dishes/version, 52 global weeks, 700,000 UTF-8 bytes/revision including recipe evidence; request limit 750,000 bytes. These are implementation bounds, not commercial limits.

## HTTP API

Hub endpoint: `/api/hospitality-rotations` (Node runtime). All responses use `Cache-Control: private, no-store`. The shared FIKA session cookie is required; no unauthenticated/local/bridge-token shortcut. Hospitality must use a server-side HTTP adapter forwarding the existing authenticated session to the configured Hub URL. Keep runtime URLs friendly and credentials server-side. Browser cross-origin/CORS and public customer access are not introduced here.

| Method/query | Authority | Successful body |
|---|---|---|
| GET `?mode=access` | Session; each capability evaluated separately | `{permissions:{View:boolean,Manage:boolean,Publish:boolean}}`; 401/503 propagate, 403 for a capability becomes false |
| GET `?mode=manage` | Manage | `{head:RotationHead,draft:RotationRevision|null}` |
| GET `?date=YYYY-MM-DD` (or `mode=published`) | View | `{schema,version,eventDate,revision:RotationRevision}`; greatest activation date <= event date |
| GET `?mode=revision&revision=N` | View | `{revision:RotationRevision}`; published evidence only, draft => 403 |
| POST save-draft | Manage | `{version,revision,replayed:boolean}` |
| POST publish | Publish | `{version,revision,replayed:boolean}` |

POST bodies:

```typescript
{ action: "save-draft", requestId: string, expectedVersion: number, configuration: RotationConfiguration }
{ action: "publish", requestId: string, expectedVersion: number, draftRevision: number, effectiveFrom: string, reason: string }
```

Use `expectedVersion: 0` for first creation. Every successful mutation increments version once, also used as immutable revision number. Saving always creates a new draft, retaining earlier revisions. Publish uses the **current draft** and creates a separate published revision with `sourceDraftRevision`, actor, reason and canonical recipe evidence. The draft is retained. Publisher must review the exact draft revision; stale aggregate or draft => 409. All categories/banks/mappings/rules/schedules are saved as one configuration. Do not submit partial group patches.

Keep a stable requestId for retry of the same payload. Receipts are actor-bound: same actor/key/content returns original version with `replayed:true`, even after a newer edit; changing content under that key => 409. After replay, reload current head before further edits. Permission is checked again before replay. Revision creation, head advancement and receipt/event evidence are atomic.

Activation uses London date-only boundaries. A published future season is scheduled immediately and selected automatically for qualifying event dates, with **no scheduled writes or GET mutation**. Dates must append strictly after existing activation dates; backdating before today's London date and replacement of an already scheduled date are rejected. This initial API intentionally has no delete, withdrawal, reschedule or replacement command; add explicit versioned supersession before supporting those UI actions. Maximum 100 activations per manifest fails closed when reached.

`RotationHead = {schema,version,draftRevision?,activations:[{effectiveFrom,revision}]}`.
`RotationRevision = {schema,revision,status,configuration,actorId,recordedAt,requestId,effectiveFrom?,reason?,sourceDraftRevision?,recipes?}`.
Published `recipes` entries contain `{dishId,recipeRevision,record}`. Record is the complete frozen canonical provider evidence, including explicit unknown allergen states; never render missing evidence as Clear. Dates/timestamps and actor IDs are server-stamped. Publication verifies the exact recipe revisions inside the transaction; stale dishes require a deliberate draft refresh/review.

Errors: `{error:{code:"ROTATIONS_<HTTP status>",message:string}}`. 401 missing/invalid session; 403 permission/draft disclosure; 404 no applicable publication/missing revision; 409 conflict, changed provider evidence or request reuse; 413 request too large; 422 invalid schema/date/rules; 503 authority/storage/integrity unavailable. Show reload/review on 409, and unavailable on 503. Never fall back to fixtures or cached operational truth. Capabilities are only UI affordances; every request is independently enforced.

## AUTHMOD provisioning (operator action, not executed)

App: `hospitality-booking`; resource: `hospitality.rotations`; organisation scope `{kind:"organisation",ids:[]}`. Separate exact actions **View**, **Manage**, **Publish** (display Publish as Activate/Publish). Manage/Publish require a person identity. Normal app access and Full Access do not grant this special resource. There are no default grants or hard-coded staff identities.

An AUTHMOD administrator identifies Sam's existing canonical person identity, verifies no other effective Manage/Publish grants for this resource, and uses the existing `POST /api/authmod/accounts/<identityId>/actions` for each required action:

```json
{ "action": "authority-grant", "appId": "hospitality-booking", "resource": "hospitality.rotations", "authorityAction": "Manage", "scope": { "kind": "organisation", "ids": [] }, "reason": "Initial exclusive Hospitality Rotations manager assignment" }
```

Repeat separately for View and Publish, plus normal Hospitality app admission if needed. No grants are changed by this implementation. Other authorised app users may receive View alone and consume published data using their FIKA session without management authority. Machine-to-machine service credential transport is not implemented; do not substitute the generic Hospitality bridge token. A future service adapter must authenticate an existing AUTHMOD service principal and enforce View separately.

## Immutable booking seam and remaining dependencies

`freezeRotationSelection(publishedRevision,{eventDate,itemId,guests,selections:[{dishId,quantity}]})` validates the applicable week, allowed dishes and every configured range/increment. It returns a detached `RotationBookingReference`:

```typescript
{ schema, publishedRevision, eventDate, itemId, groupId, week, rules, guests,
  selections: [{dishId,recipeRevision,quantity,unit}] }
```

1. **Luna/dashboard (Hospitality scope):** implement the HTTP adapter, server entry gate, capabilities, draft editing and explicit Publish action using this contract. Reuse canonical providers for pickers; the foundation does not expose a new Dish Library search. Do not ship fixture-backed management. Read the Hospitality guide and Style Guide. This PR adds no UI.
2. **Dish picker provider:** coordinate with the active Menu Planning owner for an authorised bounded canonical-ID/search consumer API or its existing read-package integration. No production sibling imports or independent recipe authority. This does not block already known ID foundation tests; it blocks a complete editor picker.
3. **Booking boundary (Hub + Hospitality):** add an optional backwards-compatible rotation reference to the existing booking schema, validate via current publication selection inside booking confirmation/amendment, and persist it atomically with the booking's immutable commercial evidence. Never accept an arbitrary client-selected old publication. Unchanged confirmed bookings must retain their frozen reference; material amendment explicitly creates a new booking revision. Existing bookings without references remain supported. This PR's helper alone does not enable live rotated booking.
4. **Customer menus:** serve the effective menu for event date through the existing authorised portal bridge after defining site/public disclosure. Preserve catalogue availability, effective Prices, notice, guest minimums and current booking authorisation in addition to rotation rules.
5. **Canonical CPU handoff:** extend existing booking → Hub Production Order line expansion with dish ID + recipe revision + frozen selection quantities/units and booking lineage, preserving destination, concurrency, cancellation/amendment/outbox idempotency. CPU must consume those lines through its existing order adapter. No second demand collection/pipeline.
6. **Operations:** approve live initial calendar/anchor/categories/banks/Item mappings; provision Sam via AUTHMOD; approve staging/production separately. No migration required for installation; until provisioning and publication, reads return no publication or denied access. Explicit supersession/withdrawal and service transport remain later work.

## Storage, cost and audit

Hub authoritative configuration/head: `integrationHubHospitalityRotationsV1/company`. Immutable history/evidence in `revisions/{number}`; idempotent command/event receipts in `commands/{actor-and-request hash}`. These are configuration and historical evidence, never a booking or dish authority. There is no mutable runtime-data commit, new listener, polling job, cache package, read audit or downstream side effect.

Ordinary published read: one head document plus one immutable revision; manage read: head plus current draft. Historical revision: one document. AUTHMOD adds its existing bounded identity/security-head/package and application/grant checks. A mutation reads head + receipt; publish additionally reads one draft and at most 150 known dish + 30 known Item documents transactionally. Every successful mutation writes exactly three documents; rejected transactions and exact retries write none. Revisions retain source, actor, before/after version and reason/lineage; this is the audit evidence, without a duplicate audit collection. A canonical JSON SHA-256 on stored revisions detects accidental evidence corruption; it is not a signature against privileged database administrators.

No catalogue scan, Item×site expansion, notifications, emails, scheduler or deployment is introduced. Frozen evidence has bounded storage cost per revision; reads do not refresh it from mutable dish records.

## Validation and review evidence

Focused tests cover the global clock, pre-anchor modulo, DST/midnight conversion, configurable cycle/rules, unique mappings, missing weeks, unknown dishes, seasonal selection, detached booking references and explicit AUTHMOD grants/revocation/outage denial.
The dedicated synthetic Firestore test exercises HTTP handlers + the real transaction adapter: concurrent edits, canonical missing/stale rejection, immutable evidence after recipe edits, future activation, read/write gates, exact retry and receipt counts. Its caller uses the real AUTHMOD evaluator with an isolated memory repository; unauthenticated production-handler access is also checked. It does not claim an end-to-end Firebase sign-in exercise.

Run the dedicated persistence test on a **fresh isolated loopback emulator** with `FIREBASE_PROJECT_ID=demo-fika-os`, `FIKA_RUNTIME_MODE=local`, `FIRESTORE_EMULATOR_HOST=<isolated port>`, `FIKA_ROTATIONS_EMULATOR_TEST=true`, then `npm exec -- tsx --test tests/hospitality-rotations.emulator.test.ts` from Hub. Ordinary `npm test` includes the file but skips its persistence test without that explicit switch. The existing `test:emulator` script enumerates older suites; it does not yet include the new file. Run this dedicated command in addition to that regression suite.

Final validation outcomes and exact PR/head evidence are recorded in the PR and task report. Review is a solo source/security/concurrency review; no independent reviewer approval or merge is claimed.
