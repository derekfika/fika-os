import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOT_FORK_BUFFET_MENU_VERSION, HOT_FORK_BUFFET_RULES_VERSION, HOT_FORK_BUFFET_SELECTION_CONTRACT, hotForkBuffetMenu } from "@fika/server-shared/hospitality-buffet-selection";
import { HospitalityBuffetOrderCard } from "../app/hospitality-buffet-orders";

const dish = (category: string, index: number) => hotForkBuffetMenu.dishes.filter(value => value.category === category)[index];
const order = (packageId: "gold" | "silver") => ({
  canonicalId: `production:${packageId}`,
  clientName: "RCoA Client",
  serviceDate: "2026-11-30",
  serviceTime: "12:30",
  serviceLocation: { floorLevel: "First Floor", roomOrArea: "Boardroom 1" },
  siteLabel: "RCoA",
  guestCount: 24,
  status: "needs_review",
  dietaries: { vegetarian: 3, allergyDetails: "Sesame allergy" },
  selectionState: "available" as const,
  selection: { contract: HOT_FORK_BUFFET_SELECTION_CONTRACT, menuVersion: HOT_FORK_BUFFET_MENU_VERSION, rulesVersion: HOT_FORK_BUFFET_RULES_VERSION, packageId, mains: [{ dishId: dish("meat", 0).id, portions: 16 }, { dishId: dish("vegan", 0).id, portions: 8 }], saladIds: [dish("salad", 0).id, dish("salad", 1).id, dish("salad", 2).id], dessertIds: packageId === "gold" ? [dish("dessert", 0).id, dish("dessert", 1).id] : [dish("dessert", 2).id] },
});

test("Delivered-In buffet card displays saved dishes, actual main portions, site, room, dietaries and Gold intent", () => {
  const html = renderToStaticMarkup(createElement(HospitalityBuffetOrderCard, { order: order("gold"), siteLabel: "RCoA" }));
  assert.match(html, /Hot Fork Buffet/);
  assert.match(html, /RCoA Client/);
  assert.match(html, /First Floor · Boardroom 1 · RCoA/);
  assert.match(html, /24/);
  assert.match(html, /16 portions/);
  assert.match(html, /8 portions/);
  assert.match(html, new RegExp(dish("meat", 0).name.split(",")[0]));
  assert.match(html, new RegExp(dish("salad", 2).name.split(",")[0]));
  assert.match(html, /50\/50 intent; chef allocates quantities/);
  assert.match(html, /Sesame allergy/);
  assert.match(html, /allergen states remain unrecorded/);
  assert.doesNotMatch(html, /undefined|NaN|production quantity|quote revision/i);
});

test("Silver buffet card shows one saved dessert without invented quantities and preserves long names", () => {
  const html = renderToStaticMarkup(createElement(HospitalityBuffetOrderCard, { order: order("silver"), siteLabel: "RCoA" }));
  assert.match(html, /Silver/);
  assert.match(html, new RegExp(dish("dessert", 2).name.split(",")[0]));
  assert.match(html, /chef allocates quantities/);
  assert.doesNotMatch(html, /dessert[\s\S]*\d+ portions/i);
  assert.match(html, /Sesame allergy/);
});

test("Delivered-In does not use current dish names for a saved older menu version", () => {
  const saved = order("gold");
  const historical = { ...saved, selection: { ...(saved.selection as Record<string, unknown>), menuVersion: "later-unregistered-version" } };
  const html = renderToStaticMarkup(createElement(HospitalityBuffetOrderCard, { order: historical, siteLabel: "RCoA" }));
  assert.match(html, /Name unavailable for this saved menu version/);
  assert.doesNotMatch(html, new RegExp(dish("meat", 0).name.split(",")[0]));
});

test("Delivered-In buffet read remains site scoped and server-authorized", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/hospitality-buffets/route.ts", import.meta.url), "utf8");
  const hubRoute = await readFile(new URL("../../integration-hub/app/api/delivered-in/hospitality-buffets/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveAccess\(request, "delivered-in"/);
  assert.match(route, /assertAuthorisedOploc/);
  assert.match(route, /redirect: "error"/);
  assert.match(hubRoute, /resolvePermittedOplocIds\(\{ repository, principal, appId: "delivered-in" \}\)/);
  assert.match(hubRoute, /where\("serviceDate", "==", serviceDate\)/);
  assert.match(hubRoute, /projectDeliveredInBuffetOrders/);
});
