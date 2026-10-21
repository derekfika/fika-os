import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localFixtureOrders } from "../app/api/local-fixtures";

test("CPU shell has labelled desktop and narrow-screen navigation with ordered responsive overrides", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  ]);
  assert.equal((page.match(/aria-label="CPU Production navigation"/g) || []).length, 2);
  assert.match(page, /className="cpu-mobile-nav"[\s\S]*?primaryNavigation\.map/);
  for (const label of ["Overview", "Day", "Queue", "Run sheet", "Totals"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
  assert.match(page, /aria-current=\{view === target \? "page" : undefined\}/);
  assert.ok(styles.lastIndexOf("@media(max-width:1120px)") > styles.indexOf(".cpu-summary{grid-template-columns:repeat(6"));
  assert.match(styles, /@media\(max-width:1120px\)[\s\S]*?\.cpu-summary\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.cpu-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(min-width:701px\) and \(max-width:980px\)[\s\S]*?\.cpu-sidebar\{width:148px/);
  assert.match(styles, /\.cpu-mobile-nav button:focus-visible[\s\S]*?outline:3px solid var\(--fika-focus-ring\)/);
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
  assert.match(styles, /@media\(max-width:1360px\)[\s\S]*?\.production-calendar \.calendar-grid\{[^}]*minmax\(185px,1fr\)[^}]*overflow-x:auto[^}]*overscroll-behavior-x:contain/);
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
