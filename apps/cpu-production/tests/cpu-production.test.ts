import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterProductionOrdersForDashboard } from "../lib/dashboard-views";
import { localFixtureOrders } from "../app/api/local-fixtures";

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

test("CPU Production is a queue-first workspace with a CPU-created order path", () => {
  assert.match(page, /Production, <em>in hand/);
  assert.match(page, /Production queue/);
  assert.match(page, /Create delivered-in lunch/);
  assert.match(route, /cpu-create/);
  assert.match(route, /sourceReference/);
});

test("CPU-created commands carry idempotency and delivery context", () => {
  assert.match(page, /idempotencyKey/);
  assert.match(page, /deliveryLocation/);
  assert.match(route, /createCpuProductionOrder/);
});

test("delivered-in lunch creator is manager-only and uses reusable scoped items", () => {
  assert.match(page, /dashboardView === "site_manager"/);
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

test("site managers have a six-week delivered-in menu planner", () => {
  assert.match(page, /Six-week menu planner/);
  assert.match(page, /view === "menu-planning"/);
  assert.match(page, /Close planner/);
  assert.match(page, /aria-label="Close six-week menu planner"/);
  assert.match(page, /onClick=\{\(\) => setView\("calendar"\)\}/);
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
  assert.match(liana, /Saved production item/);
  assert.match(liana, /Save production item/);
  assert.match(liana, /\/api\/sandwiches/);
  const libraryRoute = readFileSync(
    new URL("../app/api/sandwiches/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(libraryRoute, /production-items-seed\.json/);
  assert.match(libraryRoute, /productionItems, sandwiches: productionItems/);
  assert.match(libraryRoute, /sourceEvidence/);
});

test("CPU planning seeds real canonical hand-offs before local fixture fallback", () => {
  assert.match(planRoute, /productionOrderDetail\(orderId\)/);
  assert.match(planRoute, /productionOrderDetail\(orderId\) \|\| localFixtureOrders/);
  assert.match(planRoute, /await getPlan\(orderId\)/);
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
  assert.match(liana, /May contain notes/);
  assert.match(liana, /Enter gluten or tree nut details/);
  assert.match(liana, /Internal FIKA sign-off/);
  assert.match(liana, /sign-matrix/);
  assert.match(liana, /SignatureModal/);
  assert.match(liana, /toDataURL\("image\/png"\)/);
  assert.match(liana, /onPointerDown/);
  assert.match(liana, /Use your finger, stylus or mouse/);
  assert.match(liana, /planStatus !== "planned"/);
  assert.match(planRoute, /mayContainNotes/);
  assert.match(planRoute, /allergen-matrix-signed/);
  assert.match(planRoute, /createMatrixArtifact\(plan, command.orderId/);
  assert.match(planRoute, /allergen-matrix-archived/);
  assert.match(planRoute, /signatureDataUrl/);
  assert.match(planRoute, /Mark the allergen matrix Planned before signing it/);
});

test("CPU dashboard opens with a Monday-to-Friday production heads-up", () => {
  assert.match(page, /view === "calendar"[\s\S]*<ProductionCalendar/);
  assert.match(calendar, /Monday.*Tuesday.*Wednesday.*Thursday.*Friday/);
  assert.match(calendar, /Going to:/);
  assert.match(calendar, /Chef sets quantities/);
});

test("production views use Connections routing without duplicating bookings", () => {
  assert.match(page, /Production chef/);
  assert.match(page, /Hospitality chef/);
  assert.match(page, /Site manager \/ head chef/);
  assert.match(page, /api\/production\?view=\$\{dashboardView\}/);
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
  assert.match(planRoute, /notifyBookingConfirmedForProductionOrder/);
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
  assert.match(calendar, /workflowStatus/);
  assert.match(page, /production-plan/);
  assert.match(page, /"planned"/);
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
