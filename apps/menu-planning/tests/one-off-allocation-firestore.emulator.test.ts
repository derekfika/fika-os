import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { batchUpdateEntries, emptyWeek, updateEntry } from "../lib/rolling-menu";
import { createRollingSnapshot, getMenuPlanningOperationalStore, getWeekSnapshot } from "../lib/operational-store";
import type { RollingSnapshot } from "../lib/rolling-menu-types";
import type { MenuPlanningFirestoreRepository } from "../lib/firestore-operational-store";

test("emulator: mixed one-off portion saves roundtrip without undefined IDs and retain concurrency", { skip: process.env.MENU_ONE_OFF_EMULATOR_TEST !== "1" }, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(localhost|127\.0\.0\.1):\d+$/);
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-menu-oneoff-339");
  assert.equal(process.env.FIKA_RUNTIME_MODE, "staging");
  const snapshot = emptyWeek("2098-11-02", "emulator-test");
  const prefix = snapshot.week.id;
  snapshot.week.id += `:${randomUUID()}`;
  snapshot.days.forEach(day => { day.id = day.id.replace(prefix, snapshot.week.id); });
  snapshot.week.dayIds = snapshot.days.map(day => day.id);
  snapshot.entries = ["SOUP", "HOT MAIN"].map((slot, index) => ({ id: `${snapshot.week.id}:entry:${index}`, dayId: snapshot.days[0].id, date: snapshot.days[0].date, slot, itemLabel: `Synthetic dish ${index}`, portions: 0, allocations: [], allergens: {}, audit: [] }));
  snapshot.week.entryIds = snapshot.entries.map(entry => entry.id);
  snapshot.days[0].entryIds = snapshot.week.entryIds;
  const store = getMenuPlanningOperationalStore() as unknown as { repository: MenuPlanningFirestoreRepository };
  try {
    await createRollingSnapshot(snapshot);
    const oneOff = { destinationLabel: "Synthetic event venue 339", destinationAddress: "12 Test Street", quantity: 7, sourceLabel: "Original event venue" };
    const governed = { canonicalId: "oploc:current-339", label: "Synthetic governed site 339", legacyIds: ["oploc:old-339"] };
    const updates = snapshot.entries.map(entry => ({ entryId: entry.id, dayId: entry.dayId, allocations: [
      { destinationId: "oploc:old-339", destinationLabel: "Old label", quantity: 4 },
      { destinationLabel: governed.label, quantity: 5 },
      oneOff,
      { destinationLabel: "Blank/zero destination", quantity: 0 },
    ] }));
    const saved = await batchUpdateEntries(snapshot.week.id, 1, updates, "emulator-test", [governed]);
    assert.equal(saved.week.version, 2);
    const roundtrip = await getWeekSnapshot<RollingSnapshot>(snapshot.week.id);
    assert.ok(roundtrip);
    for (const entry of roundtrip.entries) {
      assert.equal(entry.portions, 16);
      assert.equal(entry.allocations.length, 3);
      assert.deepEqual(entry.allocations[2], oneOff);
      assert.equal(Object.hasOwn(entry.allocations[2], "destinationId"), false);
      assert.equal(entry.allocations[0].destinationId, governed.canonicalId);
      assert.equal(entry.allocations[1].destinationId, governed.canonicalId);
    }
    await assert.rejects(batchUpdateEntries(snapshot.week.id, 1, updates, "emulator-test", [governed]), { status: 409 });
    assert.equal((await getWeekSnapshot<RollingSnapshot>(snapshot.week.id))!.week.version, 2);
    // The legacy single-entry editor can explicitly supply undefined before JSON serialization.
    await updateEntry(snapshot.week.id, snapshot.entries[0].id, { allocations: [{ ...oneOff, destinationId: undefined }], portions: 7 }, "emulator-test", [], 2, snapshot.days[0].id);
    const amended = await getWeekSnapshot<RollingSnapshot>(snapshot.week.id);
    assert.equal(amended!.week.version, 3);
    assert.deepEqual(amended!.entries.find(entry => entry.id === snapshot.entries[0].id)!.allocations, [oneOff]);
    const assertDefined = (value: unknown): void => {
      assert.notEqual(value, undefined);
      if (value && typeof value === "object") Object.values(value).forEach(assertDefined);
    };
    assertDefined(amended);
  } finally {
    await store.repository.db.terminate();
  }
});
