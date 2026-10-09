import assert from "node:assert/strict";
import test from "node:test";
import { MenuArtifactError, buildMenuSlidesRequests, menuArtifactFileName, menuArtifactKey, planMenuLayout, resolveMenuTemplate, type SlidesPresentation } from "@fika/server-shared/menu-artifact";
import { MENU_FORMAT_OPTIONS, menuOutputKey } from "../lib/mnk-menu-output";
import { hospitalityMenuFromBooking, type CpuPlanForMenu } from "../lib/menu-adapter";
import type { CanonicalBooking } from "../lib/canonical-types";

const MNK_OPLOC = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const page: SlidesPresentation = { pageSize: { width: { magnitude: 6_300_200 }, height: { magnitude: 10_076_675 } }, slides: [{ objectId: "s1", pageElements: [] }] };

function booking(over: Record<string, unknown> = {}, service: Record<string, unknown> = {}): CanonicalBooking {
  return {
    canonicalId: "booking:mnk:abc", entityType: "Booking", schemaVersion: "1", version: 1, lifecycleStatus: "Sent to CPU",
    client: { name: "Derek", email: "d@example.com", companyName: "FIKA" },
    service: { eventDate: "2026-08-25", startTime: "12:00", guestCount: 12, portalSiteId: "mnk", portalSiteLabel: "MNK", oplocId: MNK_OPLOC, ...service },
    ...over,
  } as unknown as CanonicalBooking;
}
const plan = (over: Partial<CpuPlanForMenu> = {}): CpuPlanForMenu => ({
  id: "plan:1", status: "planned", updatedAt: "2026-08-20T10:00:00.000Z",
  menuItems: [{ name: "Deli Style Sandwich Lunch", subItems: [
    { name: "BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", allergens: { gluten: "contains", eggs: "contains", mustard: "contains", sulphites: "contains", milk: "clear" } },
    { name: "Vegan Feta, Pesto, Vegan Mayo, Salad", allergens: { tree_nuts: "contains", gluten: "contains", soya: "contains" } },
    { name: "Fruit Pot", allergens: { no_key_allergens: "contains" } },
  ] }],
  ...over,
});
const mnkEnv = { GOOGLE_MENU_TEMPLATE_ID_MNK: "tpl-mnk" };

test("Hospitality MNK booking normalizes to current items, selects the MNK template and renders allergens under each item", () => {
  const menu = hospitalityMenuFromBooking(booking(), plan());
  assert.equal(menu.siteKey, "mnk");
  assert.deepEqual(menu.sections[0].items.map(item => item.name), ["BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves", "Vegan Feta, Pesto, Vegan Mayo, Salad", "Fruit Pot"]);
  assert.deepEqual(menu.sections[0].items[0].contains, ["gluten", "eggs", "mustard", "sulphites"]);
  assert.equal(menuArtifactFileName(menu), "2026-08-25-12-00-FIKA-MNK");
  const template = resolveMenuTemplate({ siteKey: menu.siteKey, oplocId: menu.oplocId }, mnkEnv);
  assert.equal(template.siteKey, "mnk"); assert.equal(template.templateId, "tpl-mnk");
  const requests = buildMenuSlidesRequests(menu, template, page) as Array<Record<string, any>>;
  const text: string = requests.find(request => request.insertText)!.insertText.text;
  assert.match(text, /^BBQ Chicken Mayo, Gherkins, Tomatoes, Leaves\n\(Gluten, Eggs, Mustard, Sulphites\)\nVegan Feta, Pesto, Vegan Mayo, Salad\n\(Tree Nuts, Gluten, Soya\)\nFruit Pot$/);
  assert.equal(text.includes("(No"), false, "no_key_allergens is a positive statement, never listed as an allergen");
});

test("a dish that may contain an allergen shows it; it is never silently dropped", () => {
  const menu = hospitalityMenuFromBooking(booking(), plan({ menuItems: [{ name: "Lunch", subItems: [{ name: "Granola Pot", allergens: { gluten: "contains", milk: "may_contain" } }] }] }));
  assert.deepEqual(menu.sections[0].items[0].mayContain, ["milk"]);
  const requests = buildMenuSlidesRequests(menu, resolveMenuTemplate({ siteKey: "mnk" }, mnkEnv), page) as Array<Record<string, any>>;
  assert.match(requests.find(request => request.insertText)!.insertText.text, /Granola Pot\n\(Gluten\)$/);
});

test("an amended booking menu is built from the latest revision and is a distinct artifact", () => {
  const original = hospitalityMenuFromBooking(booking(), plan());
  const amended = hospitalityMenuFromBooking(booking({ version: 2 }), plan({ id: "plan:1", updatedAt: "2026-08-22T09:00:00.000Z", menuItems: [{ name: "Deli Style Sandwich Lunch", subItems: [{ name: "Caesar Salad", allergens: { gluten: "contains", fish: "contains" } }] }] }));
  assert.deepEqual(amended.sections[0].items.map(item => item.name), ["Caesar Salad"]);
  const key = (menu: typeof original) => menuArtifactKey(menu, "mnk-portrait-v1");
  assert.notEqual(key(amended), key(original));
  assert.equal(amended.source.id, original.source.id, "stable booking identity is preserved");
  // A CPU re-sign at the same booking version also yields a newer artifact.
  assert.notEqual(key(hospitalityMenuFromBooking(booking(), plan({ updatedAt: "2026-08-21T09:00:00.000Z" }))), key(original));
});

test("a cancelled or superseded booking/plan never becomes a current menu", () => {
  assert.throws(() => hospitalityMenuFromBooking(booking({ lifecycleStatus: "Cancelled" }), plan()), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_BOOKING_CANCELLED" && error.status === 409);
  for (const status of ["cancelled", "superseded", "withdrawn"]) assert.throws(() => hospitalityMenuFromBooking(booking(), plan({ status })), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_PLAN_NOT_CURRENT");
  assert.throws(() => hospitalityMenuFromBooking(booking(), plan({ status: "received" })), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_PLAN_NOT_PLANNED");
});

test("unrecorded or missing allergen evidence blocks the menu instead of printing a dish as clear", () => {
  const unrecorded = plan({ menuItems: [{ name: "Lunch", subItems: [{ name: "Mystery Wrap", allergens: { gluten: "unrecorded" } }] }] });
  assert.throws(() => hospitalityMenuFromBooking(booking(), unrecorded), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_UNRECORDED");
  const missing = plan({ menuItems: [{ name: "Lunch", subItems: [{ name: "Mystery Wrap" }] }] });
  assert.throws(() => hospitalityMenuFromBooking(booking(), missing), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_INCOMPLETE");
});

test("a site without a template fails safely and tells the operator what to configure", () => {
  const menu = hospitalityMenuFromBooking(booking({}, { portalSiteId: "cfc", portalSiteLabel: "CFC", oplocId: "oploc:other" }), plan());
  assert.equal(menu.siteKey, "cfc");
  assert.throws(() => resolveMenuTemplate({ siteKey: menu.siteKey, oplocId: menu.oplocId }, mnkEnv), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_SITE_UNSUPPORTED");
  assert.throws(() => resolveMenuTemplate({ siteKey: "mnk" }, {}), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_NOT_CONFIGURED" && /GOOGLE_MENU_TEMPLATE_ID_MNK/.test(error.message));
});

test("the same current booking menu renders as tablet and flat labels; a cancelled booking produces neither", () => {
  const menu = hospitalityMenuFromBooking(booking(), plan());
  assert.equal(planMenuLayout(menu, "tablet").pages.length, 1);
  const labels = planMenuLayout(menu, "flat-label").pages.flatMap(layoutPage => layoutPage.elements).filter(element => element.type === "text");
  assert.equal(labels.length, 3, "one label per dish");
  assert.equal(menuArtifactFileName(menu, "flat-label"), "2026-08-25-12-00-FIKA-MNK-flat-labels");
  assert.notEqual(menuArtifactKey(menu, "mnk-tablet-v1", "tablet"), menuArtifactKey(menu, "mnk-flat-label-v1", "flat-label"));
  assert.throws(() => hospitalityMenuFromBooking(booking({ lifecycleStatus: "Cancelled" }), plan()), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_BOOKING_CANCELLED");
});

test("each booking keeps one current output per format, and every format is offered to the manager", () => {
  assert.deepEqual(MENU_FORMAT_OPTIONS.map(option => option.value), ["tablet", "flat-label", "tent-label"]);
  assert.equal(menuOutputKey("booking:1", undefined), menuOutputKey("booking:1", "tablet"), "outputs generated before formats existed are tablet menus");
  assert.notEqual(menuOutputKey("booking:1", "flat-label"), menuOutputKey("booking:1", "tablet"));
});
