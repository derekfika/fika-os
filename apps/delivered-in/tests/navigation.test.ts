import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deliveredInHref, readDeliveredInLocation } from "../lib/navigation";

test("Delivered-In location parsing has safe defaults and stable site/period state", () => {
  assert.deepEqual(readDeliveredInLocation("?view=week&oplocId=site%3Aone&week=2026-08-24&day=2026-08-25"), { view: "week", oplocId: "site:one", week: "2026-08-24", day: "2026-08-25" });
  assert.equal(readDeliveredInLocation("?view=unknown").view, "today");
});

test("navigation hrefs preserve authorised site and selected week/day", () => {
  assert.deepEqual(readDeliveredInLocation("?view=allergens&oplocId=site%3Aone&week=2026-08-24&day=2026-08-25"), { view: "today", oplocId: "site:one", week: "2026-08-24", day: "2026-08-25" });
  assert.equal(deliveredInHref({ view: "today", oplocId: "site:one", week: "2026-08-24", day: "2026-08-25" }), "/?oplocId=site%3Aone&week=2026-08-24&day=2026-08-25");
  assert.equal(deliveredInHref({ view: "today", oplocId: "site:one" }, "/grab-and-go"), "/grab-and-go?oplocId=site%3Aone");
});

test("Delivered-In UI exposes navigation, browser history and conditional Grab & Go", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const grab = await readFile(new URL("../app/grab-and-go-page.tsx", import.meta.url), "utf8");
  assert.match(page, /aria-label=\"Delivered-In navigation\"/);
  assert.match(page, /addEventListener\(\"popstate\"/);
  assert.match(page, /selectedSite\?\.services\?\.grabAndGo/);
  assert.doesNotMatch(page, /AllergenView|Allergens<|view === "allergens"/);
  assert.match(page, /View signed CPU checker PDF/);
  assert.match(grab, /requested\.oplocId/);
  assert.match(grab, /oplocId: siteId/);
  assert.doesNotMatch(grab, /view=allergens|Allergens/);
});
