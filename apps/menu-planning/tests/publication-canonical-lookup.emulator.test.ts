import test from "node:test";
import assert from "node:assert/strict";
import { Firestore } from "@google-cloud/firestore";
import { createPublishedMenuWeek } from "../lib/menu-publication";
import { MenuPlanningFirestoreRepository } from "../lib/firestore-operational-store";
import type { RollingSnapshot } from "../lib/rolling-menu-types";

test("emulator: hosted whole-week publication validates zero-allocation dishes without emitting work for them", { skip: process.env.MENU_PUBLICATION_EMULATOR_TEST !== "1" }, async () => {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
  assert.equal(process.env.FIKA_RUNTIME_MODE, "staging");
  const db = new Firestore({ projectId: "demo-fika-os" });
  const repository = new MenuPlanningFirestoreRepository(db);
  const weekId = "rolling-week:2026-11-02";
  const days = Array.from({ length: 5 }, (_, index) => ({ id: `${weekId}:day:${index}`, date: `2026-11-0${index + 2}`, dayName: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index], entryIds: index === 0 ? ["entry:allocated", "entry:no-service"] : [] }));
  const entries = [
    { id: "entry:allocated", dayId: days[0].id, date: days[0].date, slot: "SOUP", itemId: "dish:allocated", itemLabel: "Synthetic soup", portions: 10, allocations: [{ destinationId: "oploc:synthetic", destinationLabel: "Synthetic site", quantity: 10 }], allergens: {}, audit: [] },
    { id: "entry:no-service", dayId: days[0].id, date: days[0].date, slot: "SAUCE 1", itemId: "dish:no-service", itemLabel: "Synthetic zero-allocation sauce", portions: 0, allocations: [], allergens: {}, audit: [] },
  ];
  const snapshot: RollingSnapshot = { week: { id: weekId, weekCommencing: "2026-11-02", weekEnding: "2026-11-08", version: 1, status: "draft", dayIds: days.map(day => day.id), entryIds: entries.map(entry => entry.id), sourceFiles: [], audit: [] }, days, entries };
  await repository.createRollingSnapshot(snapshot);
  for (const entry of entries) await db.collection("fikaMenuPlanningCatalogue").doc(entry.itemId).set({ kind: "dish", record: { canonicalId: entry.itemId, sourceName: entry.itemLabel, displayName: entry.itemLabel, category: entry.slot === "SOUP" ? "Soup" : "Sauce", weekId: "catalogue", dayId: "", sourceReference: { workbook: "synthetic", sheet: "fixture" }, revision: 1, reviewStatus: "unreviewed", allergenEvidence: [], mayContainReviewed: false, audit: [] } });
  // An actually missing reference still blocks without persisting publication or changing portions.
  await db.collection("fikaMenuPlanningCatalogue").doc("dish:no-service").delete();
  await assert.rejects(createPublishedMenuWeek(weekId, {}, "synthetic-publisher", new Set(["oploc:synthetic"])), /does not exist or is archived/);
  assert.equal((await repository.getWeekHead(weekId))!.version, 1);
  assert.equal((await db.collection("fikaMenuPlanningPublications").get()).size, 0);
  await db.collection("fikaMenuPlanningCatalogue").doc("dish:no-service").set({ kind: "dish", record: { canonicalId: "dish:no-service", revision: 1, reviewStatus: "archived" } });
  await assert.rejects(createPublishedMenuWeek(weekId, {}, "synthetic-publisher", new Set(["oploc:synthetic"])), /does not exist or is archived/);
  assert.equal((await repository.getWeekHead(weekId))!.version, 1);
  await db.collection("fikaMenuPlanningCatalogue").doc("dish:no-service").set({ kind: "dish", record: { canonicalId: "dish:no-service", sourceName: "Synthetic sauce", displayName: "Synthetic sauce", category: "Sauce", weekId: "catalogue", dayId: "", sourceReference: { workbook: "synthetic", sheet: "fixture" }, revision: 1, reviewStatus: "unreviewed", allergenEvidence: [], mayContainReviewed: false, audit: [] } });
  const result = await createPublishedMenuWeek(weekId, {}, "synthetic-publisher", new Set(["oploc:synthetic"]));
  assert.ok(result.publicationId);
  const saved = await repository.getWeekSnapshot(weekId);
  assert.equal(saved!.week.status, "published");
  assert.deepEqual(saved!.entries.find(entry => entry.id === "entry:no-service")!.allocations, []);
  const publication = await repository.getPublicationById(result.publicationId);
  const publishedEntries = publication!.days.filter(day => day.status === "published").flatMap(day => day.entries);
  assert.deepEqual(publishedEntries.map(entry => entry.canonicalDishId), ["dish:allocated"]);
  assert.equal(publishedEntries[0].allergens.no_key_allergens, "unrecorded");
  assert.equal((await db.collection("fikaMenuPlanningCatalogue").doc("dish:no-service").get()).get("record.reviewStatus"), "unreviewed");
  await db.terminate();
});
