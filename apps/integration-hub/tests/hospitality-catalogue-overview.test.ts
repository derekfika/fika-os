import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/ui/HospitalityCatalogueOverview.tsx", import.meta.url), "utf8");

test("overview imports its responsive stylesheet and exposes parent navigation", () => {
  assert.match(source, /import ["']\.\/HospitalityCatalogueOverview\.css["']/);
  assert.ok(source.includes("onNavigate: (tab: CatalogueOverviewTab) => void"));
  assert.ok(source.includes('onClick={() => onNavigate("items")}'));
  assert.ok(source.includes('onClick={() => onNavigate("services")}'));
  assert.ok(source.includes('onClick={() => onNavigate("locations")}'));
});

test("overview derives its displayed counts from the current payload", () => {
  assert.ok(source.includes("activeItems: payload.counts.active"));
  assert.ok(source.includes("archivedItems: payload.counts.archived"));
  assert.ok(source.includes("payload.oplocs.filter(site => site.active)"));
  assert.ok(source.includes("SERVICE_IDS.filter(id => !layout.company.services[id]?.hidden).length"));
  assert.ok(source.includes("const locationsWithOverrides = layout"));
});

test("overview explains that Hub settings do not prove portal availability", () => {
  assert.match(source, /does not\s+confirm that an Item is permitted, correctly priced, or available through a customer portal/i);
});

test("overview provides payload-backed search and compact workflow guidance", () => {
  assert.match(source, /export function searchCatalogueOverview/);
  assert.match(source, /kind: "Item"/);
  assert.match(source, /kind: "Booking Service"/);
  assert.match(source, /kind: "Category"/);
  assert.ok(source.includes("Supported booking journeys"));
  assert.ok(source.includes("Groups within a service"));
  assert.ok(source.includes("Availability and local exceptions"));
});
