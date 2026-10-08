import assert from "node:assert/strict";
import { test } from "node:test";
import { MenuArtifactError, buildMenuSlidesRequests, menuArtifactKey, resolveMenuTemplate, type SlidesPresentation } from "@fika/server-shared/menu-artifact";
import { deliveredInMenuFromDay, deliveredInMenuSiteKey } from "../lib/menu-adapter";
import { projectPublishedWeeks, type ProjectedDay, type SourceDay, type SourcePublication } from "../lib/projection";
import { siteMenuState, type SiteMenuArtifact } from "../lib/site-menu";

const MNK = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";
const site = { oplocId: MNK, label: "MNK" };
const page: SlidesPresentation = { pageSize: { width: { magnitude: 6_300_200 }, height: { magnitude: 10_076_675 } }, slides: [{ objectId: "s1", pageElements: [] }] };
const mnkEnv = { GOOGLE_MENU_TEMPLATE_ID_MNK: "tpl-mnk" };
const entry = (id: string, slot: string, dishName: string, allergens: Record<string, string>, over: Record<string, unknown> = {}) => ({ sourceEntryId: id, slot, dishName, portions: 12, allocations: [{ destinationId: MNK, destinationLabel: "MNK", quantity: 12 }], allergens, allergenEvidenceStatus: "confirmed", ...over });
const sourceDay = (over: Partial<SourceDay> = {}): SourceDay => ({
  publicationDayId: "publication:day:v1", sourceDayId: "day:tue", date: "2026-08-25", dayName: "Tuesday", version: 1, status: "published", contentHash: "hash-v1",
  entries: [
    entry("e1", "SALAD 1", "Mixed Fika Leaf Salad", { mustard: "contains", milk: "clear" }),
    entry("e2", "HOT MEAT 1", "Roast Chicken Breast", { gluten: "contains", milk: "may_contain" }),
    entry("e3", "SIDE 1", "Roasted Potatoes", { no_key_allergens: "contains" }),
  ] as never,
  allergenSignoff: { productionChef: { printedName: "PC", signedAt: "2026-08-25T08:00:00Z" }, headChefSiteManager: { printedName: "HC", signedAt: "2026-08-25T08:01:00Z" } },
  ...over,
});
const publication = (days: SourceDay[]): SourcePublication => ({ publicationId: "publication:week", sourceWeekId: "week:1", weekCommencing: "2026-08-24", weekEnding: "2026-08-30", days });
const project = (days: SourceDay[]) => projectPublishedWeeks([publication(days)], MNK, undefined, "2026-08-20").flatMap(week => week.days);

test("Delivered-In MNK day converts to the shared normalized model in Delivered-In's existing sections", () => {
  const [projected] = project([sourceDay()]);
  const menu = deliveredInMenuFromDay(projected, site);
  assert.equal(menu.siteKey, "mnk");
  assert.equal(menu.serviceDate, "2026-08-25");
  assert.deepEqual(menu.sections.map(section => section.label), ["Salads", "Hot mains", "Sides & extras"]);
  assert.deepEqual(menu.sections.map(section => section.items.map(item => item.name)), [["Mixed Fika Leaf Salad"], ["Roast Chicken Breast"], ["Roasted Potatoes"]]);
  assert.deepEqual(menu.sections[1].items[0].contains, ["gluten"]);
  assert.deepEqual(menu.sections[1].items[0].mayContain, ["milk"]);
  assert.equal(menu.source.workflow, "delivered-in");
  assert.equal(menu.fileName, "Delivered-In_MNK_2026-08-25_v1_Menu", "Delivered-In keeps its governed file name");
});

test("the MNK template is selected by site and the rendered menu carries names and allergens under each dish", () => {
  const menu = deliveredInMenuFromDay(project([sourceDay()])[0], site);
  const template = resolveMenuTemplate({ siteKey: menu.siteKey, oplocId: menu.oplocId }, mnkEnv);
  assert.equal(template.siteKey, "mnk"); assert.equal(template.templateId, "tpl-mnk");
  const requests = buildMenuSlidesRequests(menu, template, page) as Array<Record<string, any>>;
  const text: string = requests.find(request => request.insertText)!.insertText.text;
  assert.match(text, /^SALADS\n\nMixed Fika Leaf Salad\n\(Mustard\)\n\nHOT MAINS\n\nRoast Chicken Breast\n\(Gluten, Milk\)\n\nSIDES & EXTRAS\n\nRoasted Potatoes$/);
  assert.equal(requests.filter(request => request.createShape).length, 1);
});

test("withdrawn and superseded service versions are never projected, so they cannot become the current menu", () => {
  assert.equal(project([sourceDay({ status: "withdrawn" })]).length, 0);
  assert.equal(project([sourceDay({ status: "superseded" })]).length, 0);
  const current = project([sourceDay(), sourceDay({ publicationDayId: "publication:day:v2", version: 2, contentHash: "hash-v2", status: "superseded" })]);
  assert.equal(current.length, 0, "a superseded revision never renders; only an explicitly published one does");
});

test("current and historical states stay distinct: a newer published version is a new artifact and the old one is stale", () => {
  const v1 = project([sourceDay()])[0];
  const v2 = project([sourceDay({ publicationDayId: "publication:day:v2", version: 2, contentHash: "hash-v2", entries: [entry("e1", "SALAD 1", "Greek Salad", { milk: "contains" })] as never })])[0];
  const menu1 = deliveredInMenuFromDay(v1, site); const menu2 = deliveredInMenuFromDay(v2, site);
  assert.notEqual(menuArtifactKey(menu1, "mnk-portrait-v1"), menuArtifactKey(menu2, "mnk-portrait-v1"));
  const artifactForV1: SiteMenuArtifact = { artifactId: "a1", oplocId: MNK, sourceDayId: v1.sourceDayId, sourcePublicationDayId: v1.publicationDayId, sourceVersion: 1, sourceContentHash: v1.contentHash, generatedAt: "t", generatedBy: "t", driveFileId: "f1", driveUrl: "u", fileName: "n" };
  assert.equal(siteMenuState(v1, artifactForV1).status, "current");
  assert.equal(siteMenuState(v2, artifactForV1).status, "stale");
  assert.equal(siteMenuState(v2, { ...artifactForV1, revokedAt: "2026-08-26T00:00:00Z" }).status, "stale");
});

test("a retry of the same published day is the same artifact; a CPU release change at the same day is a newer one", () => {
  const day = (release?: string) => ({ ...project([sourceDay()])[0], ...(release ? { sourceLineage: { cpu: { releaseId: release, contentHash: `packet-${release}` } } } : {}) }) as ProjectedDay;
  const key = (value: ProjectedDay) => menuArtifactKey(deliveredInMenuFromDay(value, site), "mnk-portrait-v1");
  assert.equal(key(day("release:1")), key(day("release:1")));
  assert.notEqual(key(day("release:2")), key(day("release:1")));
});

test("unrecorded or unconfirmed allergen evidence blocks the menu rather than printing the dish as clear", () => {
  const unrecorded = project([sourceDay({ entries: [entry("e1", "SALAD 1", "Mystery Salad", { gluten: "unrecorded" })] as never })])[0];
  assert.throws(() => deliveredInMenuFromDay(unrecorded, site), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_UNRECORDED");
  for (const status of ["missing", "conflicting", "unreviewed"]) {
    const day = project([sourceDay({ entries: [entry("e1", "SALAD 1", "Unchecked Salad", { gluten: "clear" }, { allergenEvidenceStatus: status })] as never })])[0];
    assert.throws(() => deliveredInMenuFromDay(day, site), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_ALLERGENS_UNCONFIRMED", status);
  }
});

test("revoked-pending safety state does not block the regeneration that restores it", () => {
  const day = { ...project([sourceDay()])[0], allergenSafety: { status: "revoked_pending", releaseVersion: "release:1" } } as ProjectedDay;
  assert.doesNotThrow(() => deliveredInMenuFromDay(day, site));
});

test("sites without a shared template are outside the shared path and fail safely there", () => {
  const haleon = { oplocId: "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b", label: "Haleon" };
  assert.equal(deliveredInMenuSiteKey(haleon), undefined, "keeps using the existing Delivered-In template path");
  const [projected] = project([sourceDay()]);
  assert.throws(() => deliveredInMenuFromDay(projected, haleon), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_SITE_UNSUPPORTED");
  assert.throws(() => resolveMenuTemplate({ siteKey: "mnk" }, {}), (error: unknown) => error instanceof MenuArtifactError && error.code === "MENU_TEMPLATE_NOT_CONFIGURED");
});
