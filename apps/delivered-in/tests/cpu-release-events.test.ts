import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("CPU release event contract is bounded and packet-driven", async () => {
  const route = await readFile(new URL("../app/api/internal/cpu-release-event/route.ts", import.meta.url), "utf8");
  const event = await readFile(new URL("../lib/cpu-release-events.ts", import.meta.url), "utf8");
  const materialiser = await readFile(new URL("../lib/delivered-in-projection-materialiser.ts", import.meta.url), "utf8");
  assert.match(route, /x-fika-internal-token/);
  assert.match(event, /changedDishIds/);
  assert.match(event, /reconcileDeliveredInDay/);
  assert.match(materialiser, /CPU_PACKET_MISSING_DISH/);
  assert.match(materialiser, /CPU_REVIEW_UNSIGNED/);
  assert.match(materialiser, /review\.entries/);
});
