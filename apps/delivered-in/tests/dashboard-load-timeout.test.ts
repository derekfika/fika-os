import assert from "node:assert/strict";
import test from "node:test";
import { withDeliveredInLoadTimeout } from "../lib/dashboard-load-timeout";

test("dashboard load timeout allows a request that completes in time", async () => {
  assert.equal(
    await withDeliveredInLoadTimeout(async () => "loaded", 100),
    "loaded",
  );
});

test("dashboard load timeout rejects a request that never settles", async () => {
  await assert.rejects(
    withDeliveredInLoadTimeout(() => new Promise<never>(() => undefined), 5),
    /dashboard loading timed out/i,
  );
});
