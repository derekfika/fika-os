import assert from "node:assert/strict";
import test from "node:test";
import {
  initialProductMenuConfiguration, maximumProductMenuWeeks, productMenuChoicesForDate, productMenuConfiguration,
  productMenuDraft, productMenuSetup,
} from "../../shared/hospitality-menu-studio-product-content";
import { canonicalJson, decodeStudioPublication, publicationHash, publicationIdFor,
  type PublicationPackage } from "../../shared/hospitality-menu-studio-publication";
import { studioDishReviewKey, studioDishReviewSubject } from "../../shared/hospitality-menu-studio-safety";
import type { Dish } from "../lib/contract";

test("fixed and 1–52 week draft choices use London week boundaries across daylight saving and wraparound", () => {
  const anchorMonday = "2026-03-23";
  for (const cycleWeeks of [1, 2, 6, 9, maximumProductMenuWeeks]) {
    const draft = initialProductMenuConfiguration(productMenuSetup.parse({ kind: "rotation", anchorMonday, cycleWeeks }));
    assert.equal(productMenuChoicesForDate(draft, "2026-03-22")?.week, cycleWeeks);
    assert.equal(productMenuChoicesForDate(draft, "2026-03-29")?.week, 1);
    assert.equal(productMenuChoicesForDate(draft, "2026-03-30")?.week, cycleWeeks === 1 ? 1 : 2);
    assert.equal(productMenuChoicesForDate(draft, "2026-02-30"), undefined);
  }
  for (const cycleWeeks of [0, 2.5, maximumProductMenuWeeks + 1]) {
    assert.equal(productMenuSetup.safeParse({ kind: "rotation", anchorMonday, cycleWeeks }).success, false);
  }
  assert.equal(productMenuSetup.safeParse({ kind: "rotation", anchorMonday: "2026-03-24", cycleWeeks: 2 }).success, false);
  assert.deepEqual(productMenuChoicesForDate(initialProductMenuConfiguration({ kind: "fixed" }), "2027-01-01"), {
    choices: { dishes: [], groups: [] },
  });
});

test("choice sets retain authored order, bind exact revisions and reject ambiguous membership or commercial fields", () => {
  const dishes = [{ dishId: "dish:b", revision: 4 }, { dishId: "dish:a", revision: 2 }];
  const groups = [{ id: "hot", name: "Hot" }, { id: "cold", name: "Cold", presentation: "dropdown" }];
  const choices = { dishes: [], groups: [{ groupId: "hot", dishes }, { groupId: "cold", dishes: [] }] };
  const configuration = { presentation: "checkboxes", groups, schedule: { kind: "fixed", choices } };
  const parsed = productMenuConfiguration.parse(configuration);
  assert.deepEqual(parsed, configuration);
  assert.equal(productMenuConfiguration.safeParse({ ...configuration, salesUnit: "box" }).success, false);
  assert.equal(productMenuConfiguration.safeParse({ ...configuration, groups: [groups[0], groups[0]] }).success, false);
  for (const invalid of [
    { ...choices, dishes },
    { ...choices, groups: [...choices.groups, { groupId: "unknown", dishes: [] }] },
    { ...choices, groups: [choices.groups[0], { groupId: "cold", dishes: [dishes[0]] }] },
    { ...choices, groups: [{ groupId: "hot", dishes: [{ dishId: "dish:a", revision: 0 }] }] },
  ]) {
    assert.equal(productMenuConfiguration.safeParse({ ...configuration, schedule: { kind: "fixed", choices: invalid } }).success, false);
  }
});

test("legacy publication verifies byte-for-byte and cannot be reinterpreted as a product draft", () => {
  const dish: Dish = { id: "dish-one", version: 2, name: "First dish", category: "other", temperature: null,
    customerDescription: "Customer copy", kitchenDescription: "Private copy", assortment: null, updatedAt: "2026-11-25T11:00:00.000Z" };
  const publicationId = publicationIdFor("old-menu", 1);
  const payload: PublicationPackage = { contract: "hospitality-menu-studio.publication.v1", publicationId, publicationRevision: 1,
    sourceApp: "hospitality-menu-studio", projectId: "demo-fika-os", effectiveDate: "2026-11-30", sourceDraftVersion: 2,
    previousPublicationId: null, catalogueHash: "c".repeat(64), menu: { id: "old-menu", version: 2, name: "Old season",
      kind: "seasonal", startDate: "2026-11-30", endDate: "2027-02-28", anchorMonday: "2026-11-30", updatedAt: dish.updatedAt,
      sections: [{ id: "old-section", name: "Old section", catalogueItemId: "item-one", mode: "rotation", staticDishIds: [],
        weeks: Array.from({ length: 6 }, () => [dish.id]) }] },
    dishes: [{ dish, safety: { subject: studioDishReviewSubject(dish),
      releaseId: `cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v1`, matrixHash: "d".repeat(64) } }] };
  const body = canonicalJson(payload);
  const descriptor = { id: publicationId, menuId: payload.menu.id, menuName: payload.menu.name, revision: 1,
    effectiveDate: payload.effectiveDate, publishedAt: dish.updatedAt, publishedBy: "test-author", scope: {}, sourceDraftVersion: 2,
    contentHash: publicationHash(body) };
  assert.equal(canonicalJson(decodeStudioPublication(body, descriptor, "demo-fika-os")), body);
  assert.equal(productMenuDraft.safeParse(payload.menu).success, false);
  const modified = canonicalJson({ ...payload, menu: { ...payload.menu, configuration: initialProductMenuConfiguration({ kind: "fixed" }) } });
  assert.equal(decodeStudioPublication(modified, { ...descriptor, contentHash: publicationHash(modified) }, "demo-fika-os"), undefined);
});
