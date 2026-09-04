import assert from "node:assert/strict";
import test from "node:test";
import { loadLocalChecked, saveLocalChecked } from "../app/lib/allergen-review-local";

test("CPU checked checklist persists locally without backend state", async () => {
  await saveLocalChecked("2026-09-09", new Set(["dish:a"]));
  assert.deepEqual([...await loadLocalChecked("2026-09-09")], ["dish:a"]);
  assert.deepEqual([...await loadLocalChecked("2026-09-10")], []);
});
