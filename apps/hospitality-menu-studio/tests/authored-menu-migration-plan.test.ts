import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Dish, Menu } from "../../shared/hospitality-menu-studio-content";
import { canonicalJson, publicationHash, publicationIdFor, type PublicationPackage } from "../../shared/hospitality-menu-studio-publication";
import { studioDishReviewKey, studioDishReviewSubject } from "../../shared/hospitality-menu-studio-safety";
import { planAuthoredStudioMenuMigration } from "../lib/authored-menu-migration-plan";

const capturedAt = "2026-11-25T18:00:00.000Z";
const seal = <T>(item: T) => ({ item, archiveHash: publicationHash(canonicalJson(item)) });

function historicalPublication(menu: Menu, exactDishes: Dish[], revision = 1) {
  const payload: PublicationPackage = {
    contract: "hospitality-menu-studio.publication.v1", publicationId: publicationIdFor(menu.id, revision),
    publicationRevision: revision, previousPublicationId: revision === 1 ? null : publicationIdFor(menu.id, revision - 1),
    sourceApp: "hospitality-menu-studio", projectId: "demo-fika-os", menu, effectiveDate: menu.startDate,
    sourceDraftVersion: menu.version, catalogueHash: "b".repeat(64),
    dishes: exactDishes.map(dish => ({ dish, safety: {
      subject: studioDishReviewSubject(dish), matrixHash: "f".repeat(64),
      releaseId: `cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v1`,
    } })),
  };
  const body = canonicalJson(payload);
  return { body, manifest: {
    id: payload.publicationId, menuId: menu.id, menuName: menu.name, revision, effectiveDate: payload.effectiveDate,
    publishedAt: capturedAt, publishedBy: "fixture-publisher", scope: {}, sourceDraftVersion: menu.version, contentHash: publicationHash(body),
  } };
}

function fixture() {
  const dish = (id: string, version: number): Dish => ({
    id, version, updatedAt: capturedAt, name: "Fictional dish", category: "other", temperature: null,
    customerDescription: "Fictional description", kitchenDescription: "Private recipe that must not appear", assortment: null,
  });
  const menu: Menu = {
    id: "authored-season", version: 3, updatedAt: capturedAt, name: "Fictional season", kind: "seasonal",
    startDate: "2026-11-30", endDate: "2027-01-31", anchorMonday: "2026-11-30",
    sections: [
      { id: "food", name: "Finger Food", catalogueItemId: "item:food", mode: "rotation", staticDishIds: [], weeks: [
        ["dish:b", "dish:a"], ["dish:a"], ["dish:a"], ["dish:a"], ["dish:b"], ["dish:a"],
      ] },
      { id: "drink", name: "Tea", catalogueItemId: "item:tea", mode: "static", staticDishIds: ["dish:a"], weeks: [[], [], [], [], [], []] },
    ],
  };
  const dishes = [dish("dish:a", 2), dish("dish:b", 4)];
  return {
    contract: "fika.studio-authored-menu-export.v1", projectId: "demo-fika-os", capturedAt, catalogueHash: "b".repeat(64),
    menus: [seal(menu)], dishes: dishes.map(seal),
    publications: [historicalPublication(menu, [dishes[1], dishes[0]])],
    catalogueItems: [{ id: "item:food", presentation: "quantities" }, { id: "item:tea", presentation: "dropdown" }] as { id: string; presentation?: string }[],
    existingProductDraftIds: [] as string[],
  };
}

test("legacy menu planning preserves IDs, publication-bound archived revisions, week order and original date windows", () => {
  const source = fixture();
  const plan = planAuthoredStudioMenuMigration(source);
  assert.equal(plan.status, "REVIEW_REQUIRED");
  assert.equal(plan.activatable, false);
  assert.equal(plan.executable, false);
  const [rotating, fixed] = plan.candidates;
  assert.deepEqual([rotating.legacyMenuId, rotating.legacyMenuVersion, rotating.legacySectionId,
    rotating.legacyStartDate, rotating.legacyEndDate], ["authored-season", 3, "food", "2026-11-30", "2027-01-31"]);
  assert.deepEqual(rotating.bindingPublicationIds, [source.publications[0].manifest.id]);
  assert.deepEqual(rotating.configuration?.schedule, { kind: "rotation", anchorMonday: "2026-11-30", weeks: [
    [{ dishId: "dish:b", revision: 4 }, { dishId: "dish:a", revision: 2 }], [{ dishId: "dish:a", revision: 2 }], [{ dishId: "dish:a", revision: 2 }],
    [{ dishId: "dish:a", revision: 2 }], [{ dishId: "dish:b", revision: 4 }], [{ dishId: "dish:a", revision: 2 }],
  ].map(dishes => ({ dishes, groups: [] })) });
  assert.deepEqual(fixed.configuration?.schedule, { kind: "fixed", choices: { dishes: [{ dishId: "dish:a", revision: 2 }], groups: [] } });
  assert.doesNotMatch(JSON.stringify(plan), /Private recipe|Fictional description/);
  const reordered = { ...source, dishes: [...source.dishes].reverse(), catalogueItems: [...source.catalogueItems].reverse() };
  assert.deepEqual(planAuthoredStudioMenuMigration(reordered), plan);
});

test("capture-time dish revisions never stand in for missing or disputed menu revision evidence", () => {
  const source = fixture();
  const current = { ...source.dishes[1].item, version: 5, name: "Newer archived dish" };
  source.dishes.push(seal(current));
  const original = planAuthoredStudioMenuMigration(source).candidates[0];
  assert.equal(original.configuration?.schedule.kind, "rotation");
  assert.equal(original.configuration.schedule.weeks[0].dishes[0].revision, 4);

  const withoutPublication = planAuthoredStudioMenuMigration({ ...source, publications: [] });
  assert.match(withoutPublication.candidates[0].blockers.join(), /EXACT_DISH_REVISION_REQUIRED/);
  assert.equal(withoutPublication.candidates[0].configuration, undefined);
  const disputed = planAuthoredStudioMenuMigration({
    ...source, publications: [...source.publications, historicalPublication(source.menus[0].item, [current, source.dishes[0].item], 2)],
  });
  assert.match(disputed.candidates[0].blockers.join(), /EXACT_DISH_REVISION_REQUIRED/);
  assert.equal(disputed.candidates[0].configuration, undefined);

  const blank = structuredClone(source.menus[0].item);
  blank.sections[0].weeks[1] = [];
  const incomplete = planAuthoredStudioMenuMigration({ ...source, menus: [seal(blank)], publications: [] });
  assert.deepEqual(incomplete.candidates[0].legacySlots[1], []);
  assert.equal(incomplete.candidates[0].configuration, undefined);
});

test("migration planning refuses to choose among collisions or guess commercial dates, presentation, dish revisions or authority", () => {
  const source = fixture();
  const first = source.menus[0].item;
  source.menus = [
    seal({ ...first, endDate: "", anchorMonday: "2026-12-01" }),
    seal({ ...first, id: "authored-collection", kind: "collection", sections: [first.sections[0]] }),
  ];
  source.dishes.pop();
  source.publications = [];
  source.catalogueItems = [{ id: "item:food" }];
  source.existingProductDraftIds = ["item:food"];
  const plan = planAuthoredStudioMenuMigration(source);
  assert.equal(plan.status, "BLOCKED");
  const season = plan.candidates.find(candidate => candidate.legacyMenuId === first.id && candidate.legacySectionId === "food")!;
  assert.deepEqual(season.blockers, ["PRODUCT_DRAFT_ALREADY_EXISTS", "MULTIPLE_LEGACY_SOURCES_FOR_PRODUCT", "LEGACY_DATE_WINDOW_UNVERIFIED",
    "LEGACY_ANCHOR_MONDAY_UNVERIFIED", "REVIEWED_CHOICE_PRESENTATION_REQUIRED", "EXACT_DISH_REVISION_REQUIRED"]);
  assert.ok(plan.candidates.some(candidate => candidate.blockers.includes("COLLECTION_SCOPE_REVIEW_REQUIRED")));
  assert.ok(plan.candidates.some(candidate => candidate.blockers.includes("CURRENT_CANONICAL_ITEM_REQUIRED")));
  assert.ok(plan.candidates.every(candidate => !candidate.configuration));
});

test("changed archive bytes, duplicate IDs and production exports fail closed", () => {
  const source = fixture();
  assert.throws(() => planAuthoredStudioMenuMigration({ ...source, dishes: [{ ...source.dishes[0], archiveHash: "0".repeat(64) }] }), /exact archived revision/);
  assert.throws(() => planAuthoredStudioMenuMigration({ ...source, menus: [source.menus[0], source.menus[0]] }), /duplicate authoritative identity/);
  assert.throws(() => planAuthoredStudioMenuMigration({ ...source, projectId: "fika-os" }));
  assert.throws(() => planAuthoredStudioMenuMigration({
    ...source, publications: [{ ...source.publications[0], body: source.publications[0].body + " " }],
  }), /legacy publication could not be verified/);
});

test("the offline command emits the plan without changing the export and has no execution flag", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-authored-fixture-"));
  const file = path.join(directory, "export.json");
  const script = fileURLToPath(new URL("../scripts/plan-authored-menu-migration.ts", import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [...process.execArgv, script, ...args], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", windowsHide: true,
  });
  const source = fixture();
  const original = JSON.stringify(source);
  writeFileSync(file, original, { flag: "wx" });
  try {
    const result = run(file);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), planAuthoredStudioMenuMigration(source));
    assert.equal(run("--execute").status, 64);
    assert.deepEqual(readdirSync(directory), ["export.json"]);
    assert.equal(readFileSync(file, "utf8"), original);
  } finally {
    unlinkSync(file);
    rmdirSync(directory);
  }
});
