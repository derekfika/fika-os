import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterProductionOrdersForDashboard } from "../lib/dashboard-views";
import { aggregateProductionTotals, currentPublishedDays, groupEntriesByDestination, publishedMatrixUrl, sortPublishedMenuPublications, summarizePublishedDays } from "../lib/published-menu-selection";
import { publishPublicationChanged, publicationEventStream, subscribeToPublicationChanges } from "../lib/publication-events";
import { localFixtureOrders } from "../app/api/local-fixtures";
import { buildGrabAndGoProduction, effectiveGrabAndGoOrders, type GrabAndGoProduct, type GrabAndGoSourceOrder } from "../lib/grab-and-go-read";
import { fulfilmentFromGrabAndGoOrder, fulfilmentFromProductionOrder, fulfilmentFromPublishedMenuDay } from "@fika/contracts";
import { createDomainEvent, replayDueEvents } from "@fika/contracts";
import { reconcileFulfilmentRequirements } from "../../shared/fulfilment-reconciliation";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../app/api/production/route.ts", import.meta.url),
  "utf8",
);
const liana = readFileSync(
  new URL("../app/ui/LianaOrderDetail.tsx", import.meta.url),
  "utf8",
);
const calendar = readFileSync(
  new URL("../app/ui/ProductionCalendar.tsx", import.meta.url),
  "utf8",
);
const scope = readFileSync(
  new URL("../lib/production-scope.ts", import.meta.url),
  "utf8",
);
const productionRoute = readFileSync(
  new URL("../app/api/production/route.ts", import.meta.url),
  "utf8",
);
const planRoute = readFileSync(
  new URL("../app/api/production-plan/route.ts", import.meta.url),
  "utf8",
);
const tia = readFileSync(
  new URL("../app/tia/page.tsx", import.meta.url),
  "utf8",
);
const allergenMatrix = readFileSync(
  new URL("../app/ui/allergen-matrix.ts", import.meta.url),
  "utf8",
);
const dashboardViews = readFileSync(
  new URL("../lib/dashboard-views.ts", import.meta.url),
  "utf8",
);
const craigRoute = readFileSync(
  new URL("../app/craig/page.tsx", import.meta.url),
  "utf8",
);
const managerRoute = readFileSync(
  new URL("../app/manager/page.tsx", import.meta.url),
  "utf8",
);
const menuPlanner = readFileSync(
  new URL("../app/ui/DeliveredMenuPlanner.tsx", import.meta.url),
  "utf8",
);
const menuPlansRoute = readFileSync(
  new URL("../app/api/menu-plans/route.ts", import.meta.url),
  "utf8",
);
const menuImportRoute = readFileSync(
  new URL("../app/api/menu-plans/import/route.ts", import.meta.url),
  "utf8",
);
const publishedMenusRoute = readFileSync(new URL("../app/api/menu-publications/route.ts", import.meta.url), "utf8");
const publishedMenusView = readFileSync(new URL("../app/ui/PublishedMenuView.tsx", import.meta.url), "utf8");
const publicationEventsRoute = readFileSync(new URL("../app/api/menu-publications/events/route.ts", import.meta.url), "utf8");
const publicationInvalidateRoute = readFileSync(new URL("../app/api/menu-publications/invalidate/route.ts", import.meta.url), "utf8");

test("CPU Production is a queue-first workspace with a CPU-created order path", () => {
  assert.match(page, /Production, <em>in hand/);
  assert.match(page, /Production queue/);
  assert.match(page, /Create delivered-in lunch/);
  assert.match(route, /cpu-create/);
  assert.match(route, /sourceReference/);
});

test("Head Chef receives immutable Menu Planning publication days as a read-only projection", () => {
  assert.match(publishedMenusRoute, /menuPlanningJson/);
  assert.match(publishedMenusRoute, /format.*matrix/);
  assert.match(publishedMenusRoute, /publicationDayId/);
  assert.match(publishedMenusRoute, /status === "published"/);
  assert.match(publishedMenusRoute, /publishedAllergenMatrixHtml/);
  assert.match(publishedMenusRoute, /requireCpuActor/);
  assert.match(publishedMenusView, /Head chef · Read only/);
  assert.match(publishedMenusView, /Not published/);
  assert.match(publishedMenusView, /currentPublishedDays/);
  assert.match(publishedMenusView, /sortPublishedMenuPublications/);
  assert.match(publishedMenusView, /Published v\$\{day\.version\}/);
  assert.match(publishedMenusView, /Signed allergen matrix/);
  assert.match(publishedMenusView, /publicationDayId/);
  assert.match(publishedMenusView, /groupEntriesByDestination/);
  assert.match(publishedMenusView, /publishedMatrixUrl/);
  assert.match(publishedMenusView, /window\.open\(publishedMatrixUrl\(selected\.publicationId, day\.publicationDayId\)/);
  assert.doesNotMatch(publishedMenusView, /fetch\(`\/api\/menu-publications\?publicationId/);
  assert.match(publishedMenusView, /blocked by your browser/);
  assert.match(publishedMenusView, /production-calendar/);
  assert.match(publishedMenusView, /calendar-grid/);
  assert.match(publishedMenusView, /published-day-section/);
  assert.doesNotMatch(publishedMenusView, /ViewMode/);
  assert.match(publishedMenusView, /published-week-board/);
  assert.match(publishedMenusView, /published-day-section/);
  assert.match(publishedMenusView, /published-week-summary/);
  assert.match(publishedMenusView, /published-day-jumps/);
  assert.match(publishedMenusView, /Production totals/);
  assert.match(publishedMenusView, /By destination/);
  assert.match(publishedMenusView, /EventSource\("\/api\/menu-publications\/events"\)/);
  assert.match(publishedMenusView, /setInterval\(.*30000/);
  assert.match(publishedMenusView, /visibilitychange/);
  assert.match(publicationEventsRoute, /text\/event-stream/);
  assert.match(publicationInvalidateRoute, /publishPublicationChanged/);
  assert.match(publishedMenusView, /aggregateProductionTotals/);
  assert.match(publishedMenusView, /No production menu published/);
  assert.match(publishedMenusView, /href=\{`#published-day-\$\{date\}`\}/);
  assert.match(page, /productionScopes/);
  assert.match(page, /scope=\$\{productionScope\}/);
});

test("published menu selection keeps only the latest version for each service date", () => {
  const current = currentPublishedDays([
    { date: "2026-08-24", version: 1, status: "superseded" },
    { date: "2026-08-24", version: 2, status: "published" },
    { date: "2026-08-25", version: 1, status: "published" },
  ]);
  assert.equal(current.get("2026-08-24")?.version, 2);
  assert.equal(current.get("2026-08-25")?.version, 1);
  assert.equal(current.has("source-day-id"), false);
});

test("published menu weeks are ordered newest first", () => {
  const sorted = sortPublishedMenuPublications([
    { weekCommencing: "2026-08-17" },
    { weekCommencing: "2026-08-24" },
  ]);
  assert.deepEqual(sorted.map(item => item.weekCommencing), ["2026-08-24", "2026-08-17"]);
});

test("published production groups allocations by destination and keeps destination quantities", () => {
  const groups = groupEntriesByDestination([
    { slot: "SALAD 1", dishName: "Mixed Baby Leaf", portions: 20, allocations: [{ destinationLabel: "Haleon", quantity: 10 }, { destinationLabel: "FIKA Xchange", quantity: 10 }] },
    { slot: "HOT MEAT", dishName: "Jerk Chicken", portions: 25, allocations: [{ destinationLabel: "Haleon", quantity: 25 }] },
  ]);
  assert.deepEqual(groups.map(group => [group.destinationLabel, group.total]), [["Haleon", 35], ["FIKA Xchange", 10]]);
  assert.deepEqual(groups[0].entries.map(entry => entry.quantity), [10, 25]);
  assert.equal(groups[1].entries[0].quantity, 10);
  assert.deepEqual(summarizePublishedDays([{ groups }, { groups: [{ destinationLabel: "Commerzbank", total: 20, entries: [] }] }]), { portions: 65, locations: 3, days: 2 });
});

test("production totals aggregate canonical dishes and legacy names without merging different dishes", () => {
  const totals = aggregateProductionTotals([
    { slot: "SALAD 1", canonicalDishId: "dish:leaf", dishName: "Mixed Baby Leaf", portions: 20, allocations: [{ destinationLabel: "Haleon", quantity: 10 }, { destinationLabel: "FIKA Xchange", quantity: 10 }] },
    { slot: "SALAD 2", canonicalDishId: "dish:leaf", dishName: "Mixed Baby Leaf", portions: 5, allocations: [{ destinationLabel: "Haleon", quantity: 5 }] },
    { slot: "SALAD 1", dishName: "Mixed Leaf Salad", portions: 4, allocations: [{ destinationLabel: "Haleon", quantity: 4 }] },
    { slot: "SALAD 1", dishName: "Mixed Leaf Salad", portions: 3, allocations: [{ destinationLabel: "FIKA Xchange", quantity: 3 }] },
    { slot: "SALAD 1", dishName: "Different Salad", portions: 2, allocations: [{ destinationLabel: "Haleon", quantity: 2 }] },
  ]);
  assert.deepEqual(totals.map(item => [item.dishName, item.quantity]), [["Mixed Baby Leaf", 25], ["Mixed Leaf Salad", 7], ["Different Salad", 2]]);
});

test("signed matrix URL keeps the exact publication and day identity", () => {
  assert.equal(publishedMatrixUrl("publication:week 1", "publication:day:v2"), "/api/menu-publications?publicationId=publication%3Aweek%201&publicationDayId=publication%3Aday%3Av2&format=matrix");
});

test("CPU publication events invalidate without carrying menu snapshots", () => {
  let received = "";
  const unsubscribe = subscribeToPublicationChanges(event => { received = publicationEventStream(event); });
  publishPublicationChanged({ event: "publication_changed", publicationDayId: "publication:day:v2", serviceDate: "2026-08-24", version: 2, action: "amended" });
  unsubscribe();
  assert.match(received, /event: publication_changed/);
  assert.match(received, /publication:day:v2/);
  assert.doesNotMatch(received, /entries|dishName|snapshot/);
});

test("Grab & Go production aggregates current submitted orders by product and destination", () => {
  const catalogue: GrabAndGoProduct[] = [
    { productId: "pot", name: "Fruit Pot", category: "grab_250ml", sortOrder: 1, active: true },
    { productId: "salad", name: "Stacking Salad", category: "stacking_salad_750ml", sortOrder: 2, active: true },
  ];
  const order = (oplocId: string, version: number, status: GrabAndGoSourceOrder["status"], quantity: number): GrabAndGoSourceOrder => ({ orderId: `${oplocId}:order`, oplocId, deliveryDate: "2026-08-24", status, version, submittedAt: "2026-08-19T12:00:00Z", lines: [{ productId: "pot", productName: "Fruit Pot", quantity }] });
  const production = buildGrabAndGoProduction("2026-08-24", [order("haleon", 1, "cancelled", 10), order("haleon", 2, "submitted", 4), order("xchange", 1, "submitted", 6), { ...order("draft", 1, "cancelled", 20), status: "draft" }], catalogue, { haleon: "Haleon", xchange: "FIKA Xchange", draft: "Draft" });
  assert.equal(effectiveGrabAndGoOrders([order("haleon", 1, "submitted", 99), order("haleon", 2, "submitted", 4)], "2026-08-24")[0].version, 2);
  assert.deepEqual(production.totals.map(item => [item.productId, item.quantity]), [["pot", 10]]);
  assert.deepEqual(production.destinations.map(destination => [destination.siteName, destination.totalItems]), [["Haleon", 4], ["FIKA Xchange", 6]]);
  assert.equal(production.totals[0].quantity, production.destinations.reduce((sum, destination) => sum + destination.items[0].quantity, 0));
});

test("Grab & Go production honours submitted snapshots when catalogue changes or disappears", () => {
  const submitted: GrabAndGoSourceOrder = { orderId: "order", oplocId: "site", deliveryDate: "2026-08-24", status: "submitted", version: 1, submittedAt: "now", lines: [{ productId: "pot", productName: "Original Fruit Pot", category: "grab_250ml", sortOrder: 1, quantity: 4, price: 1.85 }] };
  const renamedOrInactive = [{ productId: "pot", name: "Renamed Fruit Pot", category: "grab_250ml" as const, sortOrder: 99, active: false }];
  const production = buildGrabAndGoProduction("2026-08-24", [submitted], renamedOrInactive, { site: "Haleon" });
  assert.deepEqual(production.totals.map(item => [item.productName, item.quantity]), [["Original Fruit Pot", 4]]);
  const withoutCatalogue = buildGrabAndGoProduction("2026-08-24", [submitted], [], { site: "Haleon" });
  assert.deepEqual(withoutCatalogue.destinations[0].items.map(item => [item.productName, item.quantity]), [["Original Fruit Pot", 4]]);
});

test("CPU, published-menu and Grab & Go sources normalise to one Fulfilment Requirement contract", () => {
  const production = fulfilmentFromProductionOrder({ canonicalId: "production-order:v1:hospitality", version: 1, productionLocationId: "oploc:cpux", destinationOplocId: "oploc:haleon", destinationLabel: "Haleon", serviceDate: "2026-08-24", requiredBy: "2026-08-24T09:00:00", serviceWindow: { startTime: "12:00" }, status: "ready", lines: [{ canonicalId: "production-line:1", sourceMenuItemId: "menu:dish", itemName: "Mixed Leaf", customerQuantity: 10, customerUnit: "portion", productionQuantity: 10, productionUnit: "portion", sortOrder: 0 }] }, "cpu");
  const published = fulfilmentFromPublishedMenuDay({ publicationDayId: "publication:day:v1", sourceDayId: "rolling-week:day:1", version: 2, contentHash: "hash-day", date: "2026-08-24", status: "published", entries: [{ sourceEntryId: "entry:salad", canonicalDishId: "dish:salad", dishName: "Mixed Leaf", slot: "SALAD 1", allocations: [{ destinationId: "oploc:haleon", destinationLabel: "Haleon", quantity: 7 }] }] }, "oploc:haleon");
  const grab = fulfilmentFromGrabAndGoOrder({ orderId: "grab-and-go:oploc:haleon:2026-08-24", oplocId: "oploc:haleon", deliveryDate: "2026-08-24", version: 3, status: "submitted", lines: [{ productId: "grab:pot", productName: "Fruit Pot", quantity: 4, sortOrder: 0 }] }, "site");
  for (const requirement of [production, published, grab]) {
    assert.equal(requirement.entityType, "Fulfilment Requirement");
    assert.equal(requirement.destinationOplocId, "oploc:haleon");
    assert.equal(requirement.lines[0].quantity, requirement === production ? 10 : requirement === published ? 7 : 4);
    assert.ok(requirement.sourceEntityId);
    assert.ok(requirement.idempotencyKey);
  }
  assert.equal(production.sourceDomain, "cpu-production");
  assert.equal(published.sourceContentHash, "hash-day");
  assert.equal(grab.lines[0].canonicalItemId, "grab:pot");
});

test("Fulfilment Requirement identity is idempotent, versions amendments, and propagates withdrawal", () => {
  const source = { orderId: "grab-and-go:oploc:one:2026-08-24", oplocId: "oploc:one", deliveryDate: "2026-08-24", version: 1, status: "submitted" as const, lines: [{ productId: "grab:pot", productName: "Fruit Pot", quantity: 4, sortOrder: 0 }] };
  const first = fulfilmentFromGrabAndGoOrder(source, "site", "2026-08-20T10:00:00Z");
  const same = fulfilmentFromGrabAndGoOrder(source, "site", "2026-08-20T10:01:00Z", first);
  assert.deepEqual(same, first);
  const amended = fulfilmentFromGrabAndGoOrder({ ...source, version: 2, lines: [{ ...source.lines[0], quantity: 6 }] }, "site", "2026-08-21T10:00:00Z", first);
  assert.equal(amended.canonicalId, first.canonicalId);
  assert.equal(amended.version, 2);
  assert.equal(amended.status, "amended");
  assert.equal(amended.lines[0].quantity, 6);
  const withdrawn = fulfilmentFromGrabAndGoOrder({ ...source, version: 3, status: "cancelled" }, "site", "2026-08-22T10:00:00Z", amended);
  const withdrawnFromHistory = fulfilmentFromGrabAndGoOrder({ ...source, version: 3, status: "cancelled" }, "site", "2026-08-22T10:00:00Z", amended);
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.version, 3);
  assert.deepEqual(withdrawnFromHistory, withdrawn);
});

test("Fulfilment Requirements keep canonical destinations distinct from matching labels", () => {
  const day = { publicationDayId: "publication:day:v1", sourceDayId: "rolling-week:day:1", version: 1, contentHash: "hash", date: "2026-08-24", status: "published" as const, entries: [{ sourceEntryId: "entry:one", canonicalDishId: "dish:one", dishName: "Dish One", slot: "SALAD 1", allocations: [{ destinationId: "oploc:one", destinationLabel: "Shared label", quantity: 2 }, { destinationId: "oploc:two", destinationLabel: "Shared label", quantity: 3 }] }] };
  const one = fulfilmentFromPublishedMenuDay(day, "oploc:one");
  const two = fulfilmentFromPublishedMenuDay(day, "oploc:two");
  assert.notEqual(one.canonicalId, two.canonicalId);
  assert.equal(one.destinationOplocId, "oploc:one");
  assert.equal(two.destinationOplocId, "oploc:two");
  assert.equal(one.lines[0].canonicalItemId, "dish:one");
  assert.equal(one.lines[0].quantity, 2);
  assert.equal(two.lines[0].quantity, 3);
});

test("CPU Grab & Go source is an API boundary, not a Delivered-In filesystem read", () => {
  const source = readFileSync(new URL("../lib/grab-and-go-read.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/grab-and-go/route.ts", import.meta.url), "utf8");
  assert.match(source, /DELIVERED_IN_GRAB_AND_GO_API_URL/);
  assert.match(source, /readGrabAndGoSource/);
  assert.doesNotMatch(source, /readFileSync|local-data|grab-and-go-orders\.json|grab-and-go-catalogue\.json/);
  assert.doesNotMatch(route, /readFileSync|local-data|grab-and-go-orders\.json/);
});

test("Grab & Go CPU view keeps categories, zero quantities, and the separate top-level workflow", () => {
  const view = readFileSync(new URL("../app/ui/GrabAndGoProductionView.tsx", import.meta.url), "utf8");
  assert.match(view, /useState<ProductionMode>\("totals"\)/);
  assert.match(view, /mode === "totals" \?/);
  assert.match(view, /onClick=\{\(\) => setMode\("destination"\)\}/);
  assert.match(view, /selectedDate/);
  assert.match(view, /Production totals/);
  assert.match(view, /By destination/);
  assert.match(view, /Grab n Go · 250ml/);
  assert.match(page, /Grab & Go production/);
  const production = buildGrabAndGoProduction("2026-08-24", [{ orderId: "order", oplocId: "site", deliveryDate: "2026-08-24", status: "submitted", version: 1, submittedAt: "now", lines: [{ productId: "pot", productName: "Fruit Pot", quantity: 0 }] }], [{ productId: "pot", name: "Fruit Pot", category: "grab_250ml", sortOrder: 1, active: true }]);
  assert.equal(production.totals.length, 0);
});

test("CPU-created commands carry idempotency and delivery context", () => {
  assert.match(page, /idempotencyKey/);
  assert.match(page, /deliveryLocation/);
  assert.match(route, /createCpuProductionOrder/);
});

test("legacy delivered-in lunch creator remains isolated from the four-workspace navigation", () => {
  assert.match(page, /function CpuCreate/);
  assert.match(page, /parentMenuItemKey=delivered-in-lunch/);
  assert.match(page, /Create draft production order/);
  assert.match(page, /CPU-created Delivered-in Lunch draft/);
  assert.match(page, /lines\.map/);
});

test("delivered-in lunch creator supports governed OPLOCs, one-off locations and CPU-style allergen cells", () => {
  assert.match(page, /fetch\("\/api\/oplocs"/);
  assert.match(page, /OTHER_OPLOC/);
  assert.match(page, /Other — one-off delivery/);
  assert.match(page, /productionLocationId/);
  assert.match(page, /titleCaseLabel/);
  assert.match(page, /cpu-create-allergen-matrix/);
  assert.match(page, /cpu-create-allergen-cell--\$\{state\}/);
  assert.match(page, /CANONICAL_ALLERGEN_COLUMNS/);
  assert.match(page, /mayContainNotes/);
});

test("delivered-in lunch creator can save and reuse new menu items", () => {
  assert.match(page, /saveNewItem/);
  assert.match(page, /Type a new item title/);
  assert.match(page, /parentMenuItemKey: "delivered-in-lunch"/);
  assert.match(page, /Save new item/);
});

test("CPU exposes five canonical production scopes and removes obsolete manager controls", () => {
  assert.match(page, /productionScopes/);
  assert.match(scope, /All production/);
  assert.match(scope, /Sandwiches/);
  assert.match(scope, /Hospitality/);
  assert.match(scope, /Delivered-In/);
  assert.match(scope, /Grab & Go/);
  assert.doesNotMatch(page, /Six-week menu planner/);
  assert.doesNotMatch(page, /Published delivered-in menus<\/button>/);
  assert.doesNotMatch(page, /Create delivered-in lunch<\/button>/);
  assert.match(page, /<DeliveredMenuPlanner/);
  assert.match(menuPlanner, /Six-week delivered-in menu/);
  assert.match(menuPlanner, /Week \{index \+ 1\}/);
  assert.match(menuPlanner, /Save six-week menu/);
  assert.match(menuPlanner, /Import an existing workbook/);
  assert.match(menuPlanner, /Imported workbooks remain evidence/);
  assert.match(menuPlanner, /category\?\.startsWith\("Salad "\)/);
});

test("menu workbook imports remain reviewable evidence and plans are persisted locally", () => {
  assert.match(menuImportRoute, /XLSX\.read/);
  assert.match(menuImportRoute, /needs_review/);
  assert.match(menuImportRoute, /sourceEvidence/);
  assert.match(menuImportRoute, /allergenSheets/);
  assert.match(menuImportRoute, /mon|tue|wed|thurs|fri/);
  assert.match(menuPlansRoute, /delivered-menu:/);
  assert.match(menuPlansRoute, /delivered-in-menus\.json/);
  assert.match(menuPlanner, /may_contain/);
  assert.match(menuPlanner, /Allergen states are entered by the production team/);
});

test("Liana production view captures nested menu items and sub-item allergen evidence", () => {
  assert.match(liana, /Service date/);
  assert.match(liana, /Digital master allergen checker/);
  assert.match(liana, /Add rows/);
  assert.match(liana, /Add rows/);
  assert.match(liana, /allergen-cell--\$\{state\}/);
  assert.match(liana, /may_contain/);
  assert.match(liana, /toggleOperationalAllergen/);
  assert.match(liana, /CANONICAL_ALLERGEN_COLUMNS/);
  assert.match(liana, /sourceLineId/);
  assert.match(liana, /mergeOriginalItems/);
  assert.doesNotMatch(liana, /portions/);
  assert.doesNotMatch(liana, /Optional source \/ review note/);
  assert.match(planRoute, /menuItems/);
  assert.match(liana, /order\.guestCount/);
  assert.match(liana, /order\.lines\.reduce/);
  assert.match(liana, /sourceLineId/);
  assert.match(liana, /CANONICAL_ALLERGEN_COLUMNS/);
  assert.match(liana, /Saved menu item/);
  assert.match(liana, /Save menu item/);
  assert.match(liana, /\/api\/sandwiches/);
  const libraryRoute = readFileSync(
    new URL("../app/api/sandwiches/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(libraryRoute, /menuPlanningJson/);
  assert.match(libraryRoute, /productionItems: items, sandwiches: items/);
  assert.doesNotMatch(libraryRoute, /local-data\/menu-planning|saved-sandwiches\.json|production-items-seed\.json/);
});

test("CPU planning seeds real canonical hand-offs before local fixture fallback", () => {
  assert.match(planRoute, /productionOrderDetail\(request, orderId\)/);
  assert.match(planRoute, /isLocalRuntime\(\) \? localFixtureOrders/);
  assert.match(planRoute, /await getPlan\(request, orderId\)/);
});

test("allergen checker uses the master-style purple header and four-state cells", () => {
  const css = readFileSync(
    new URL("../app/ui/liana.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /allergen-checker thead th[^\{]*\{[^}]*background:\s*#4f34c7/,
  );
  assert.match(css, /allergen-cell--may_contain.*MC|may_contain/);
  assert.match(liana, /toggleOperationalAllergen/);
  assert.match(allergenMatrix, /<th>Chef<br>Printed name \/ signature<\/th>/);
  assert.match(
    allergenMatrix,
    /Pre-service check<br>Head chef \/ site manager/,
  );
  assert.doesNotMatch(allergenMatrix, /Food prepared by/);
  assert.doesNotMatch(allergenMatrix, /Completion of form overseen by/);
  assert.doesNotMatch(allergenMatrix, /Verified by Location Manager/);
  assert.match(allergenMatrix, /Week commencing date/);
  assert.match(allergenMatrix, /weekCommencing/);
  assert.match(allergenMatrix, /CANONICAL_ALLERGEN_COLUMNS/);
  assert.match(allergenMatrix, /Service area \/ service type \/ service time/);
  assert.match(allergenMatrix, /serviceType/);
  assert.match(allergenMatrix, /serviceDay/);
  assert.match(liana, /Notes/);
  assert.match(liana, /Enter specific gluten, tree nut or other details/);
  assert.match(liana, /Internal FIKA sign-off/);
  assert.match(liana, /sign-matrix/);
  assert.match(liana, /SignatureModal/);
  assert.match(liana, /toDataURL\("image\/png"\)/);
  assert.match(liana, /onPointerDown/);
  assert.match(liana, /Use your finger, stylus or mouse/);
  assert.match(liana, /planStatus !== "planned"/);
  assert.match(planRoute, /mayContainNotes/);
  assert.match(planRoute, /allergen-matrix-signed/);
  assert.match(planRoute, /save-matrix/);
  assert.match(planRoute, /allergen-matrix-signature-complete/);
  assert.match(planRoute, /signedMenuContentHash/);
  assert.match(planRoute, /plan\.signatures = undefined/);
  assert.match(planRoute, /plan\.matrixArtifact = undefined/);
  assert.match(planRoute, /signatureDataUrl/);
  assert.match(planRoute, /Mark the allergen matrix Planned before signing it/);
});

test("CPU dashboard opens with a Monday-to-Friday production heads-up", () => {
  assert.match(page, /view === "calendar"[\s\S]*<ProductionCalendar/);
  assert.match(calendar, /Monday.*Tuesday.*Wednesday.*Thursday.*Friday/);
  assert.match(calendar, /OPLOC/);
  assert.match(calendar, /pieces\/quantities/);
});

test("production views use Connections routing without duplicating bookings", () => {
  assert.match(page, /productionScope/);
  assert.doesNotMatch(page, /dashboardView/);
  assert.match(page, /api\/production\?scope=\$\{productionScope\}/);
  assert.match(route, /hospitalityMenuProductionRouting/);
  assert.match(dashboardViews, /site_manager.*return orders/s);
  assert.match(dashboardViews, /assigned\.includes\(/);
  assert.match(dashboardViews, /filterProductionOrdersForDashboard/);
  assert.match(craigRoute, /view=hospitality/);
  assert.match(managerRoute, /view=site_manager/);
});

test("production view routing keeps one booking and filters only its assigned lines", () => {
  const order = {
    canonicalId: "production-order:v1:booking:test",
    origin: "hospitality_booking",
    lines: [
      { canonicalId: "line:production", sourceMenuItemId: "menu:one" },
      { canonicalId: "line:hospitality", sourceOfferingId: "menu:two" },
      { canonicalId: "line:manager", sourceMenuItemId: "menu:three" },
    ],
  } as any;
  const routing: Record<string, ("liana" | "craig" | "site_manager")[]> = {
    "menu:one": ["liana"],
    "menu:two": ["craig"],
    "menu:three": ["site_manager"],
  };
  assert.deepEqual(
    filterProductionOrdersForDashboard([order], "production", routing)[0].lines.map((line) => line.canonicalId),
    ["line:production"],
  );
  assert.deepEqual(
    filterProductionOrdersForDashboard([order], "hospitality", routing)[0].lines.map((line) => line.canonicalId),
    ["line:hospitality"],
  );
  assert.equal(filterProductionOrdersForDashboard([order], "site_manager", routing)[0].lines.length, 3);
  assert.equal(filterProductionOrdersForDashboard([order], "hospitality", {}).length, 1);
});

test("legacy hospitality provider line identities split sandwich and hospitality work", () => {
  const order = {
    canonicalId: "production-order:v1:booking:angel-court",
    origin: "hospitality_booking",
    lines: [
      { canonicalId: "line:sandwich", sourceOfferingId: "deli-style-sandwich" },
      { canonicalId: "line:fruit", sourceOfferingId: "exotic-fruit-box" },
      { canonicalId: "line:traybake", sourceOfferingId: "mini-traybake-bites" },
    ],
  } as any;
  const routing: Record<string, ("liana" | "craig" | "site_manager")[]> = {
    "deli-style-sandwich": ["liana"],
    "exotic-fruit-box": ["craig"],
    "mini-traybake-bites": ["craig"],
  };
  assert.deepEqual(
    filterProductionOrdersForDashboard([order], "production", routing)[0].lines.map((line) => line.canonicalId),
    ["line:sandwich"],
  );
  assert.deepEqual(
    filterProductionOrdersForDashboard([order], "hospitality", routing)[0].lines.map((line) => line.canonicalId),
    ["line:fruit", "line:traybake"],
  );
});

test("canonical MNK menu identities remain routable after a hand-off", () => {
  const routing: Record<string, ("liana" | "craig" | "site_manager")[]> = {
    "hospitality-menu-item:mnk:deli_sandwich_lunch": ["liana"],
    "hospitality-menu-item:mnk:exotic_fruit_box": ["craig"],
    "hospitality-menu-item:mnk:mini_pastries": ["craig"],
  };
  const order = {
    canonicalId: "production-order:v1:booking:mnk-canonical",
    origin: "hospitality_booking",
    lines: [
      { canonicalId: "line:sandwich", sourceMenuItemId: "hospitality-menu-item:mnk:deli_sandwich_lunch" },
      { canonicalId: "line:fruit", sourceMenuItemId: "hospitality-menu-item:mnk:exotic_fruit_box" },
      { canonicalId: "line:pastry", sourceMenuItemId: "hospitality-menu-item:mnk:mini_pastries" },
    ],
  } as any;
  assert.deepEqual(
    filterProductionOrdersForDashboard([order], "production", routing)[0].lines.map((line) => line.canonicalId),
    ["line:sandwich"],
  );
  assert.deepEqual(
    filterProductionOrdersForDashboard([order], "hospitality", routing)[0].lines.map((line) => line.canonicalId),
    ["line:fruit", "line:pastry"],
  );
});

test("Liana workflow keeps production planning separate from later completion tracking", () => {
  assert.match(liana, /Save partial plan/);
  assert.match(liana, /Mark as Planned/);
  assert.doesNotMatch(liana, /Actual made/);
  assert.doesNotMatch(liana, /Shortfall/);
  assert.doesNotMatch(liana, /Substitution/);
  assert.match(planRoute, /evidenceStatus !== "completed"/);
});

test("production commands remain local and have no calendar or spreadsheet side effects", () => {
  assert.doesNotMatch(route, /CalendarApp|SpreadsheetApp|GmailApp/);
  assert.match(route, /update-lines/);
});

test("local development remains testable without a Firebase session", () => {
  assert.match(productionRoute, /localFixtureOrders/);
  assert.match(productionRoute, /NODE_ENV !== "production"/);
  assert.match(productionRoute, /localFixture/);
});

test("CPU plans hand completed allergen evidence to Tia without external side effects", () => {
  assert.match(planRoute, /mark-planned/);
  assert.match(planRoute, /New production plan ready for menu generation/);
  assert.match(planRoute, /evidenceStatus !== "completed"/);
  assert.match(tia, /Save \/ share menu/);
  assert.match(tia, /menuItem/);
  assert.match(tia, /mayContain\.length/);
  assert.doesNotMatch(planRoute, /CalendarApp|SpreadsheetApp|GmailApp/);
  assert.match(planRoute, /\[\.\.\.plans\.values\(\)\]/);
});

test("CPU acceptance has a confirmation-email seam for canonical hospitality hand-offs", () => {
  assert.match(planRoute, /production-confirmation/);
  assert.match(planRoute, /productionOrderDetail/);
});

test("weekly calendar uses local operational date keys and is not trapped by the queue date filter", () => {
  assert.match(calendar, /getFullYear\(\)/);
  assert.match(calendar, /getMonth\(\)/);
  assert.match(calendar, /getDate\(\)/);
  assert.match(page, /ProductionCalendar orders=\{baseVisible\}/);
  assert.match(calendar, /calendar-day-summary/);
  assert.match(calendar, /Dietary:/);
  assert.match(calendar, /production-card--\$\{status\}/);
  assert.match(calendar, /cpuLifecycle/);
  assert.match(page, /production-plan/);
  assert.match(page, /workflowStatus/);
});

test("local CPU fixtures cover two weeks of portal bookings with routed menu and dietary data", () => {
  const fixtures = localFixtureOrders();
  assert.equal(fixtures.length, 21);
  assert.equal(new Set(fixtures.map(order => order.sourceBookingId.split("-")[0])).size, 5);
  assert.equal(Math.min(...fixtures.map(order => Date.parse(order.serviceDate!))), Date.parse("2026-08-17"));
  assert.equal(Math.max(...fixtures.map(order => Date.parse(order.serviceDate!))), Date.parse("2026-08-30"));
  assert.ok(fixtures.some(order => order.status === "blocked"));
  assert.ok(fixtures.some(order => order.status === "in_production"));
  assert.ok(fixtures.some(order => order.status === "complete"));
  assert.ok(fixtures.some(order => Object.keys(order.lines.flatMap(line => Object.keys(line.dietaries))).length > 0));
  assert.ok(fixtures.every(order => order.lines.every(line => line.sourceMenuItemId)));
});

test("durable events survive consumer outage, replay idempotently, and protect source ordering", async () => {
  const v1 = createDomainEvent({ eventType: "fulfilment.requirement.created", sourceAggregateId: "requirement:one", sourceVersion: 1, occurredAt: "2026-08-24T08:00:00Z", payload: { quantity: 10 } });
  const v2 = createDomainEvent({ eventType: "fulfilment.requirement.amended", sourceAggregateId: "requirement:one", sourceVersion: 2, occurredAt: "2026-08-24T08:01:00Z", payload: { quantity: 12 } });
  let unavailable = true;
  const applied: number[] = [];
  const first = await replayDueEvents([v2, v1], (event) => {
    if (unavailable) { unavailable = false; throw new Error("consumer unavailable"); }
    applied.push(event.sourceVersion);
  }, new Date("2026-08-24T08:02:00Z"));
  assert.equal(first.delivered, 1);
  assert.equal(first.failed, 1);
  const second = await replayDueEvents(first.events, event => { applied.push(event.sourceVersion); }, new Date("2026-08-24T08:03:00Z"));
  assert.deepEqual(applied, [2]);
  assert.equal(second.delivered, 0);
  assert.equal(second.events.filter(event => event.delivery.status === "delivered").length, 2);
});

test("fulfilment reconciliation identifies missing, stale, withdrawn and failed handoffs", () => {
  const source = { orderId: "order:one", oplocId: "oploc:one", deliveryDate: "2026-08-24", version: 2, status: "submitted" as const, lines: [{ productId: "product:one", productName: "Mixed Leaf", quantity: 4, sortOrder: 0 }] };
  const requirement = fulfilmentFromGrabAndGoOrder(source, "site", "2026-08-24T08:00:00Z");
  const failed = createDomainEvent({ eventType: "grab-and-go.order.submitted", sourceAggregateId: source.orderId, sourceVersion: source.version, occurredAt: "2026-08-24T08:00:00Z", payload: source });
  const failedWithMetadata = { ...failed, delivery: { ...failed.delivery, status: "failed" as const, attempts: 1, lastError: "Delivered-In unavailable" } };
  const expected = [{ sourceDomain: "grab-and-go" as const, sourceEntityId: source.orderId, sourceVersion: 3, destinationOplocId: source.oplocId, status: "active" as const }];
  const issues = reconcileFulfilmentRequirements(expected, [requirement], [failedWithMetadata]);
  assert.ok(issues.some(issue => issue.kind === "stale_requirement"));
  assert.ok(issues.some(issue => issue.kind === "failed_event"));
  const withdrawnIssues = reconcileFulfilmentRequirements([{ ...expected[0], status: "withdrawn" }], [requirement], []);
  assert.ok(withdrawnIssues.some(issue => issue.kind === "withdrawn_source_still_active"));
  const missingIssues = reconcileFulfilmentRequirements(expected, [], []);
  assert.ok(missingIssues.some(issue => issue.kind === "missing_requirement"));
});
