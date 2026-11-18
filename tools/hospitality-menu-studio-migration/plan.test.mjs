import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stableDocumentId } from "../../packages/server-shared/src/stable-document-id.ts";
import { planRotationMigration } from "./plan.mjs";

const capture = "2026-10-24T23:30:00.000Z";
const itemId = "hospitality-menu-item:example";
const dishId = "hospitality-dish:example";
const sharedDishId = "menu-item:shared-example";
const unlinkedDishId = "hospitality-dish:unlinked";
const schema = "hospitality-rotations.v1";
const recipe = (id, revision, operationalScope) => ({
  canonicalId: id, revision, operationalScope, hospitalityClass: "finger-food", reviewStatus: "unreviewed",
  displayName: "Synthetic dish", description: "Private draft text", allergenEvidence: [],
});
const dish = (id, revision, scope = "HOSPITALITY_ROTATIONS") => ({ id, data: { kind: "dish", record: recipe(id, revision, scope) } });

function storedRevision(revision) {
  // The Hub hashes sorted object properties, including the provider payload, with arrays in their captured order.
  const sorted = value => {
    if (Array.isArray(value)) return value.map(sorted);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  };
  const data = { schema, actorId: "synthetic-editor", recordedAt: capture, requestId: `synthetic:${revision.revision}`, ...revision };
  const evidenceHash = createHash("sha256").update(JSON.stringify(sorted(data))).digest("hex");
  return { id: String(data.revision), data: { ...data, evidenceHash } };
}

function configuration(dishRevision, unfinished = false, cycleWeeks = 6) {
  return {
    schema, label: "Synthetic rotation", calendar: { cycleWeeks, anchorMonday: "2026-09-07", timeZone: "Europe/London" },
    categories: [{ id: "finger-food", label: "Finger food" }],
    groups: [{
      id: "finger", categoryId: "finger-food", label: "Finger food", itemId,
      dishBank: unfinished ? [] : [{ dishId, recipeRevision: dishRevision }, { dishId: sharedDishId, recipeRevision: 1 }],
      weeks: Array.from({ length: cycleWeeks }, (_, index) => ({
        week: index + 1, dishIds: unfinished ? [] : index === 1 ? [sharedDishId, dishId] : [dishId, sharedDishId],
      })),
      rules: { guests: { minimum: 6, maximum: 90, increment: 1 }, distinctDishes: { minimum: 1, maximum: 2 },
        quantityPerDish: { minimum: 6, maximum: 60, increment: 6 }, unit: "pieces" },
    }],
  };
}

function source() {
  const effective = "2026-09-01";
  const future = "2026-11-02";
  const linked = {
    schema: "hospitality-rotation-dish-link.v1", itemId, dishId, classification: "finger-food",
    actorId: "synthetic-editor", recordedAt: capture, requestId: "synthetic:link",
  };
  const draft = (revision, dishRevision, unfinished) => storedRevision({ revision, status: "draft", configuration: configuration(dishRevision, unfinished) });
  const published = (revision, dishRevision, effectiveFrom) => storedRevision({
    revision, status: "published", sourceDraftRevision: revision - 1, effectiveFrom, reason: "Synthetic publication",
    configuration: configuration(dishRevision),
    recipes: [
      { dishId, recipeRevision: dishRevision, record: recipe(dishId, dishRevision, "HOSPITALITY_ROTATIONS") },
      { dishId: sharedDishId, recipeRevision: 1, record: recipe(sharedDishId, 1, "SHARED") },
    ],
  });
  return {
    schema: "hospitality-rotations-export.v1",
    projectId: "demo-fika-os", capturedAt: capture,
    head: { schema, version: 5, draftRevision: 5, activations: [{ revision: 2, effectiveFrom: effective }, { revision: 4, effectiveFrom: future }] },
    revisions: [draft(1, 1), published(2, 1, effective), draft(3, 2), published(4, 2, future), draft(5, 2, true)],
    dishLinks: [{ id: stableDocumentId(itemId), data: linked }],
    dishLinksByDish: [{ id: stableDocumentId(dishId), data: { ...linked } }],
    dishes: [dish(dishId, 2), dish(sharedDishId, 1, "SHARED"), dish(unlinkedDishId, 1)],
    items: [{ id: stableDocumentId(itemId), data: { canonicalId: itemId, entityType: "Hospitality Menu Item",
      lifecycleStatus: "published", publicationStatus: "published", record: { displayName: "Synthetic Item" } } }],
    destinationBindings: [],
  };
}

function codes(report) {
  return report.issues.map(issue => issue.code);
}

test("keeps legacy IDs, exact revisions, activation dates and week ordering without publishing or copying text", () => {
  const input = source();
  const report = planRotationMigration(input);
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.equal(report.activatable, false);
  assert.equal(report.source.inventoryDate, "2026-10-25");
  assert.equal(report.effectiveLegacyRevision, 2);
  assert.equal(report.draftRevision, 5);
  assert.deepEqual(report.legacyActivationManifest, input.head.activations);
  assert.deepEqual(report.rotationRevisions[1].groups[0].weeks[1].dishIds, [sharedDishId, dishId]);
  assert.deepEqual(report.rotationRevisions[4].groups[0].weeks[1].dishIds, []);
  assert.equal(report.rotationRevisions[1].groups[0].itemId, itemId);
  assert.equal(report.designatedLinks[0].dishId, dishId);
  assert.equal(report.dishSources.find(entry => entry.dishId === dishId && entry.recipeRevision === 1).action, "PRESERVE_HISTORICAL_SOURCE");
  assert.equal(report.dishSources.find(entry => entry.dishId === dishId && entry.recipeRevision === 2).action, "PROPOSE_INACTIVE_DRAFT");
  assert.equal(report.dishSources.find(entry => entry.dishId === sharedDishId).action, "KEEP_EXACT_PROVIDER_REFERENCE");
  assert.equal(report.dishSources.find(entry => entry.dishId === unlinkedDishId).action, "PROPOSE_INACTIVE_DRAFT");
  assert.ok(report.issues.some(issue => issue.code === "STUDIO_CONTENT_AND_SAFETY_REVIEW_REQUIRED" && issue.id === `${dishId}@1`));
  assert.doesNotMatch(JSON.stringify(report), /Private draft text|synthetic-editor|allergenEvidence/);
});

test("same snapshot has the same plan hash when export document order varies", () => {
  const input = source();
  const first = planRotationMigration(input);
  const repeated = planRotationMigration({ ...input, revisions: [...input.revisions].reverse(), dishes: [...input.dishes].reverse() });
  assert.deepEqual(repeated, first);
  const { dishId: id, recipeRevision, sourceHash } = first.dishSources[0];
  input.destinationBindings = [{ dishId: id, recipeRevision, sourceHash }];
  assert.deepEqual(planRotationMigration(input), first);
  input.destinationBindings[0].sourceHash = "0".repeat(64);
  assert.ok(codes(planRotationMigration(input)).includes("DESTINATION_SOURCE_HASH_CONFLICT"));
  delete input.destinationBindings;
  assert.ok(codes(planRotationMigration(input)).includes("DESTINATION_BINDINGS_UNCHECKED"));
});

test("hash, immutable recipe coverage and published-from-current-draft lineage are checked independently", () => {
  const changed = source();
  changed.revisions[1].data.recipes[0].record.description = "altered after hashing";
  assert.ok(codes(planRotationMigration(changed)).includes("REVISION_HASH_MISMATCH"));

  const badEvidence = source();
  const { evidenceHash, ...raw } = badEvidence.revisions[1].data;
  badEvidence.revisions[1] = storedRevision({ ...raw, recipes: raw.recipes.slice(1) });
  const { evidenceHash: sideHash, ...side } = badEvidence.revisions[3].data;
  badEvidence.revisions[3] = storedRevision({ ...side, sourceDraftRevision: 1 });
  const issues = codes(planRotationMigration(badEvidence));
  assert.ok(issues.includes("FROZEN_RECIPE_MISSING_OR_MISMATCHED"));
  assert.ok(issues.includes("PUBLISHED_DRAFT_LINEAGE_MISMATCH"));
  assert.ok(!issues.includes("REVISION_HASH_MISMATCH"));
});

test("rejects missing, duplicate and out-of-order source history", () => {
  const input = source();
  input.revisions = [input.revisions[0], input.revisions[1], input.revisions[3], input.revisions[3], input.revisions[4]];
  input.head.draftRevision = 1;
  input.head.activations.reverse();
  const report = planRotationMigration(input);
  assert.equal(report.status, "BLOCKED");
  for (const code of ["MISSING_LEGACY_REVISION", "DUPLICATE_IDENTITY", "DRAFT_POINTER_MISMATCH", "ACTIVATIONS_OUT_OF_ORDER"]) {
    assert.ok(codes(report).includes(code), code);
  }
});

test("requires live published and draft cohorts to fit six weeks without relabelling legacy schedules", () => {
  const input = source();
  for (const index of [0, 1, 4]) {
    const { evidenceHash, ...data } = input.revisions[index].data;
    input.revisions[index] = storedRevision({ ...data, configuration: configuration(index < 2 ? 1 : 2, index === 4, 8) });
  }
  const report = planRotationMigration(input);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.rotationRevisions[1].calendar.cycleWeeks, 8);
  assert.equal(report.issues.filter(issue => issue.code === "STUDIO_SIX_WEEK_CYCLE_INCOMPATIBLE").length, 2);

  input.capturedAt = "2026-11-03T12:00:00.000Z";
  const later = planRotationMigration(input);
  assert.equal(later.effectiveLegacyRevision, 4);
  assert.equal(later.rotationRevisions[1].calendar.cycleWeeks, 8);
  assert.equal(later.issues.filter(issue => issue.code === "STUDIO_SIX_WEEK_CYCLE_INCOMPATIBLE").length, 1);
});

test("flags inconsistent link, catalogue identity and exact current draft references", () => {
  const input = source();
  input.dishLinksByDish = [];
  input.items[0].data.publicationStatus = "withdrawn";
  input.dishes[0].data.record.displayName = "same revision with different bytes";
  input.revisions[4] = storedRevision({ revision: 5, status: "draft", configuration: configuration(12) });
  const report = planRotationMigration(input);
  for (const code of ["DESIGNATED_DISH_LINK_MISMATCH", "CURRENT_ITEM_UNAVAILABLE", "CURRENT_DRAFT_DISH_REVISION_UNAVAILABLE", "DISH_REVISION_CONTENT_CONFLICT"]) {
    assert.ok(codes(report).includes(code), code);
  }
});

test("rejects a second reverse link even when the original link pair is intact", () => {
  const input = source();
  input.dishLinksByDish.push({
    id: stableDocumentId(unlinkedDishId),
    data: { ...input.dishLinksByDish[0].data, dishId: unlinkedDishId },
  });
  assert.ok(codes(planRotationMigration(input)).includes("DESIGNATED_DISH_LINK_MISMATCH"));
});

test("empty legacy authority is explicit and a malformed or substituted export fails closed", () => {
  const empty = {
    schema: "hospitality-rotations-export.v1", projectId: "demo-fika-os", capturedAt: capture, head: null,
    revisions: [], dishLinks: [], dishLinksByDish: [], dishes: [], items: [], destinationBindings: [],
  };
  const report = planRotationMigration(empty);
  assert.equal(report.source.headVersion, 0);
  assert.equal(report.effectiveLegacyRevision, undefined);
  assert.equal(report.activatable, false);

  assert.equal(planRotationMigration({ ...empty, items: null }).status, "INVALID_EXPORT");
  assert.equal(planRotationMigration({ ...empty, extra: "unexpected" }).status, "INVALID_EXPORT");
  const input = source();
  input.items[0].id = "another-item";
  assert.ok(codes(planRotationMigration(input)).includes("INVALID_CATALOGUE_ITEM"));
});

test("CLI reads explicit files, emits deterministic JSON and cannot execute a migration", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "studio-rotations-"));
  const filename = resolve(dir, "source.json");
  const executable = fileURLToPath(new URL("./dry-run.mjs", import.meta.url));
  const json = JSON.stringify(source());
  const execute = (...args) => spawnSync(process.execPath, [executable, ...args], { encoding: "utf8" });
  try {
    writeFileSync(filename, json);
    const result = execute(filename);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "REVIEW_REQUIRED");
    assert.equal(execute(filename, "--execute").status, 64);
    assert.equal(execute("https://example.invalid/export.json").status, 64);
    assert.equal(readFileSync(filename, "utf8"), json);
    assert.deepEqual(readdirSync(dir), ["source.json"]);

    const incomplete = source();
    incomplete.head.version = 6;
    writeFileSync(filename, JSON.stringify(incomplete));
    const blocked = execute(filename);
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).status, "BLOCKED");
    writeFileSync(filename, "malformed");
    assert.equal(execute(filename).status, 65);
  } finally {
    rmSync(filename, { force: true });
    rmdirSync(dir);
  }
});
