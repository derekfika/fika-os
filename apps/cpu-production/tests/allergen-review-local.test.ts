import assert from "node:assert/strict";
import test from "node:test";
import { clearLocalDraft, loadLocalChecked, loadLocalDraft, saveLocalChecked, saveLocalDraft } from "../app/lib/allergen-review-local";

test("CPU checked checklist persists locally without backend state", async () => {
  await saveLocalChecked("2026-09-09", new Set(["dish:a"]));
  assert.deepEqual([...await loadLocalChecked("2026-09-09")], ["dish:a"]);
  assert.deepEqual([...await loadLocalChecked("2026-09-10")], []);
});

test("CPU review draft persists edited states, checked rows and exact source lineage", async () => {
  const draft = {
    states: { "menu_planning:publication-day:salad": { milk: "clear" as const } },
    checkedRows: ["menu_planning:publication-day:salad"],
    lineageByOrderId: {
      "production-order:1": {
        productionOrderId: "production-order:1",
        serviceDate: "2026-09-09",
        sourceDayId: "day:1",
        sourcePublicationDayId: "publication-day:1",
        sourceVersion: 2,
        sourceContentHash: "a".repeat(64),
        matrixContentHash: "b".repeat(64),
      },
    },
    savedAt: "2026-09-09T09:00:00.000Z",
  };
  await saveLocalDraft("2026-09-09:all", draft);
  assert.deepEqual(await loadLocalDraft("2026-09-09:all"), draft);
  await clearLocalDraft("2026-09-09:all");
  assert.equal(await loadLocalDraft("2026-09-09:all"), undefined);
});
