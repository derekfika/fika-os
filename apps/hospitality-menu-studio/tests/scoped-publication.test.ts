import assert from "node:assert/strict";
import test from "node:test";
import type { Dish, Menu, Section } from "../lib/contract";
import type { PublicationPackage } from "../lib/publication";
import { publicationContent } from "../lib/scoped-publication";

const date = "2026-11-30";
const section = (id: string, ids: string[]): Section => ({ id, name: id, catalogueItemId: "hospitality-menu-item:" + id,
  mode: "static", staticDishIds: ids, weeks: [[], [], [], [], [], []] });
const first = section("breakfast", ["shared", "old"]);
const second: Section = { ...section("buffet", []), mode: "rotation", weeks: [
  ["shared", "week-one"], ["shared", "week-two"], ["shared"], ["shared"], ["shared"], ["shared"],
] };
const menu: Menu = { id: "menu", version: 1, name: "Published menu", kind: "seasonal", startDate: date, endDate: "2027-03-01",
  anchorMonday: date, updatedAt: date, sections: [first, second] };
const frozen = (id: string): PublicationPackage["dishes"][number] => {
  const dish: Dish = { id, version: 1, name: id, category: "other", temperature: null, customerDescription: "Customer copy",
    kitchenDescription: "Kitchen copy", assortment: null, updatedAt: date };
  return { dish, safety: { subject: { dishId: id, revision: 1, sourceHash: "a".repeat(64) }, releaseId: "fixture", matrixHash: "b".repeat(64) } };
};
const previous: PublicationPackage = { contract: "hospitality-menu-studio.publication.v1", publicationId: "before",
  publicationRevision: 1, sourceApp: "hospitality-menu-studio", projectId: "demo-fika-os", menu, effectiveDate: date, sourceDraftVersion: 1,
  previousPublicationId: null, catalogueHash: "c".repeat(64), dishes: ["shared", "old", "week-one", "week-two"].map(frozen) };
const draft: Menu = { ...menu, version: 2, name: "Unrelated draft rename", anchorMonday: "2026-12-07", sections: [
  { ...first, name: "Changed breakfast", staticDishIds: ["fresh", "shared"] },
  { ...second, mode: "rotation", name: "Unrelated buffet rename", catalogueItemId: "hospitality-menu-item:other",
    weeks: [["new-first-week"], ["shared", "fresh"], ["shared"], ["shared"], ["shared"], ["shared"]] },
] };

test("a scoped section retains other sections and the revision of a dish they share", () => {
  const planned = publicationContent(draft, { sectionId: first.id }, previous);
  assert.equal(planned.menu.name, menu.name);
  assert.equal(planned.menu.version, 2);
  assert.deepEqual(planned.menu.sections, [draft.sections[0], second]);
  assert.deepEqual(planned.refreshDishIds, ["fresh"]);
  assert.deepEqual(planned.preserved.map(({ dish }) => dish.id), ["shared", "week-one", "week-two"]);
  assert.match(planned.changes.join(" "), /shared keeps published revision 1/);
  assert.deepEqual(planned.impactItemIds, [first.catalogueItemId]);
});

test("a rotating week amendment preserves published schedule, untouched weeks and mapping", () => {
  const planned = publicationContent(draft, { sectionId: second.id, week: 2 }, previous);
  assert.equal(planned.menu.anchorMonday, menu.anchorMonday);
  assert.deepEqual(planned.menu.sections[0], first);
  assert.deepEqual(planned.menu.sections[1], { ...second, weeks: [second.weeks[0], draft.sections[1].weeks[1], ...second.weeks.slice(2)] });
  assert.deepEqual(planned.refreshDishIds, ["fresh"]);
  assert.deepEqual(planned.rotation, { anchorMonday: date, week: 2 });
  assert.deepEqual(planned.impactItemIds, [second.catalogueItemId]);
});

test("a dish amendment refreshes every occurrence without changing published placements", () => {
  const planned = publicationContent(draft, { sectionId: second.id, week: 2, dishId: "shared" }, previous);
  assert.deepEqual(planned.menu.sections, menu.sections);
  assert.deepEqual(planned.refreshDishIds, ["shared"]);
  assert.deepEqual(planned.preserved.map(({ dish }) => dish.id), ["old", "week-one", "week-two"]);
  assert.match(planned.changes.join(" "), /all 7 placements/);
  assert.equal(planned.impactScope, "dish-selection");
  assert.deepEqual(planned.impactItemIds, [first.catalogueItemId, second.catalogueItemId]);
  assert.equal(publicationContent(draft, { sectionId: second.id, week: 1, dishId: "week-two" }, previous).issues.length, 1);
});

test("removed sections use the original catalogue item for booking impacts and require a base", () => {
  const removal = publicationContent({ ...draft, sections: [draft.sections[0]] }, { sectionId: second.id }, previous);
  assert.deepEqual(removal.menu.sections, [first]);
  assert.deepEqual(removal.refreshDishIds, []);
  assert.deepEqual(removal.impactItemIds, [second.catalogueItemId]);
  assert.match(publicationContent(draft, { sectionId: first.id }).issues.join(" "), /Publish the whole menu/);
});
