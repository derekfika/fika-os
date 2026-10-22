import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localFixtureOrders } from "../app/api/local-fixtures";

test("CPU shell keeps labelled navigation and responsive overrides after desktop rules", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);
  assert.equal((page.match(/aria-label="CPU Production navigation"/g) || []).length, 1);
  assert.match(page, /className="cpu-sidebar-nav"[\s\S]*?primaryNavigation\.map/);
  for (const label of ["Overview", "Day", "Queue", "Run sheet", "Totals"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
  assert.match(page, /aria-current=\{view === target \? "page" : undefined\}/);
  assert.match(page, /cpu-sidebar-collapse[\s\S]*?aria-label=\{sidebarCollapsed \? "Expand production navigation" : "Collapse production navigation"\}/);
  assert.match(page, /title=\{sidebarCollapsed \? label : undefined\}/);
  assert.ok(styles.lastIndexOf("@media (max-width:1360px), (pointer:coarse)") > styles.indexOf(".cpu-summary{grid-template-columns:repeat(6"));
  assert.match(styles, /\.cpu-summary\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)\}/);
  assert.match(styles, /@media \(max-width:1360px\), \(pointer:coarse\)[\s\S]*?\.cpu-summary\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.cpu-summary button:last-child\{grid-column:span 3\}/);
  assert.match(styles, /@media \(max-width:700px\)[\s\S]*?\.cpu-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.cpu-summary button:last-child\{grid-column:span 2\}/);
  assert.match(styles, /\.cpu-sidebar-nav button:focus-visible[\s\S]*?outline:3px solid var\(--fika-focus-ring\)/);
});

test("tablet navigation uses a touch-aware drawer and hides the desktop operations rail", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /matchMedia\("\(max-width: 1360px\), \(pointer: coarse\)"\)/);
  assert.match(page, /aria-label="Open production navigation"[\s\S]*?aria-expanded=\{drawerOpen\}[\s\S]*?aria-controls="cpu-primary-navigation"/);
  assert.match(page, /role=\{tabletNavigation && drawerOpen \? "dialog" : undefined\}/);
  assert.match(page, /aria-hidden=\{tabletNavigation \? !drawerOpen : undefined\}/);
  assert.match(page, /inert=\{tabletNavigation && !drawerOpen\}/);
  assert.match(page, /event\.key === "Escape"[\s\S]*?setDrawerOpen\(false\)/);
  assert.match(page, /event\.shiftKey[\s\S]*?last\.focus\(\)[\s\S]*?first\.focus\(\)/);
  assert.match(page, /className="cpu-sidebar-backdrop"[\s\S]*?onClick=\{\(\) => setDrawerOpen\(false\)\}/);
  assert.doesNotMatch(page, /className="cpu-mobile-nav"/);
  assert.match(page, /Review in Queue/);
  assert.match(page, /setStatus\(""\);[\s\S]*setOrigin\(""\);[\s\S]*setSite\(""\);[\s\S]*setDate\(""\)/);
  assert.match(styles, /\.cpu-dashboard-columns\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(styles, /@media \(max-width:1360px\), \(pointer:coarse\)[\s\S]*?\.cpu-operations-rail\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(styles, /@media \(max-width:700px\)[\s\S]*?\.cpu-operations-rail\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(styles, /\.cpu-sidebar\.cpu-sidebar--open\{transform:translateX\(0\);visibility:visible\}/);
  assert.match(styles, /\.cpu-sidebar-backdrop:not\(\[hidden\]\)[\s\S]*?display:block/);
  assert.match(styles, /\.cpu-tablet-menu-toggle:focus-visible[\s\S]*?outline:3px solid var\(--fika-focus-ring\)/);
});

test("CPU Overview exposes Day, Week and Run sheet controls beside refresh", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /className="cpu-view-switch"[\s\S]*?>Week<\/button>[\s\S]*?>Day<\/button>[\s\S]*?>Run sheet<\/button>[\s\S]*?aria-label="Refresh production"/);
  assert.match(page, /const chooseDayView = \(\) => \{[\s\S]*setDayDate\(selectedDate\)[\s\S]*setWeekCommencing\(weekCommencingFor\(selectedDate\)\)/);
  assert.match(page, /onClick=\{\(\) => chooseView\("run-sheet"\)\}/);
});

test("CPU calendar and interactive detail styles retain bounded scrolling and touch targets", async () => {
  const [styles, calendar, allergens, hospitalityMatrix, orderDetail, hospitalityDetail, grabDetail, deliveredDetail] = await Promise.all([
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/production-calendar.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/allergen-review.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/hospitality-allergen-detail.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/production-order-detail.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/hospitality-production-detail.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/grab-and-go-order-detail.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/delivered-in-production-detail.css", import.meta.url), "utf8"),
  ]);
  assert.match(styles, /@media \(max-width:1360px\), \(pointer:coarse\)[\s\S]*?\.production-calendar \.calendar-grid\{[^}]*minmax\(185px,1fr\)[^}]*overflow-x:auto[^}]*overscroll-behavior-x:contain/);
  assert.match(calendar, /\.calendar-nav button\{[^}]*min-height:44px/);
  assert.match(calendar, /\.calendar-day-open\{[^}]*min-height:44px/);
  assert.match(allergens, /\.cpu-allergen-state\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(allergens, /\.cpu-allergen-table-wrap\{[^}]*overscroll-behavior:contain/);
  assert.match(allergens, /\.cpu-allergen-check\{[^}]*min-height:44px/);
  assert.match(hospitalityMatrix, /\.allergen-checker \.check-button[^}]*min-height:44px/);
  assert.match(hospitalityMatrix, /\.matrix-signing-controls button[^}]*min-height:44px/);
  for (const detail of [orderDetail, hospitalityDetail]) {
    assert.match(detail, /header>button\{[^}]*width:44px[^}]*height:44px/);
    assert.match(detail, /footer button\{[^}]*min-height:44px/);
  }
  assert.match(grabDetail, /header button\{[^}]*width:44px[^}]*height:44px/);
  assert.match(grabDetail, /footer button\{[^}]*min-height:44px/);
  assert.match(deliveredDetail, /\.delivered-in-detail>header>button[^}]*min-width:44px;min-height:44px/);
});

test("CPU production detail surfaces retain explicit close actions", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/ui/ProductionOrderDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/HospitalityProductionDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/GrabAndGoOrderDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of files.slice(0, 3)) {
    assert.match(source, /role="dialog" aria-modal="true"/);
    assert.match(source, /onClick=\{close\}/);
  }
  assert.match(files[3], /<aside className="cpu-detail">[\s\S]*?onClick=\{close\}[\s\S]*?aria-label="Close order"/);
});

test("local CPU display fixture covers varied production records without writing operational data", () => {
  const fixtures = localFixtureOrders();
  assert.ok(fixtures.length >= 10);
  assert.ok(fixtures.some((order) => /Royal College of Art/i.test(order.destinationLabel || "")));
  assert.ok(new Set(fixtures.map((order) => order.status)).size >= 3);
});
