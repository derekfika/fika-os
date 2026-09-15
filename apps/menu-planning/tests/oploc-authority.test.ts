import assert from "node:assert/strict";
import { test } from "node:test";
import { readDeliveredInOplocs } from "../lib/oploc-authority";

const request = () => new Request("http://menu-planning.test/api/oplocs", { headers: { cookie: "session=test" } }) as any;

function withHubFixture(fixture: unknown, callback: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.FIKA_HUB_BASE_URL;
  process.env.FIKA_HUB_BASE_URL = "http://hub.test";
  globalThis.fetch = (async () => Response.json(fixture)) as typeof fetch;
  return callback().finally(() => {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.FIKA_HUB_BASE_URL;
    else process.env.FIKA_HUB_BASE_URL = previousBaseUrl;
  });
}

test("service-arrangement legacy OPLOCs resolve to canonical Hub metadata", async () => {
  await withHubFixture({
    arrangements: [{ oplocId: "oploc:old", oplocLabel: "Old label", serviceLabel: "Delivered-In", lifecycleState: "active" }],
    oplocs: [{ canonicalId: "oploc:current", label: "Current Site" }],
    oplocRedirects: { "oploc:old": "oploc:current" },
  }, async () => {
    const result = await readDeliveredInOplocs(request());
    assert.deepEqual(result, [{ canonicalId: "oploc:current", label: "Current Site", legacyIds: ["oploc:old"] }]);
  });
});

test("OPLOC redirects resolve transitively and deduplicate old/current arrangements", async () => {
  await withHubFixture({
    arrangements: [
      { oplocId: "oploc:a", serviceLabel: "Delivered-In", lifecycleState: "active" },
      { oplocId: "oploc:b", serviceLabel: "Delivered-In", lifecycleState: "active" },
      { oplocId: "oploc:c", serviceLabel: "Delivered-In", lifecycleState: "active" },
    ],
    oplocs: [{ canonicalId: "oploc:c", label: "Current Site" }],
    oplocRedirects: { "oploc:a": "oploc:b", "oploc:b": "oploc:c" },
  }, async () => {
    const result = await readDeliveredInOplocs(request());
    assert.deepEqual(result, [{ canonicalId: "oploc:c", label: "Current Site", legacyIds: ["oploc:a", "oploc:b"] }]);
  });
});

test("invalid OPLOC redirect chains fail closed without inventing authority", async () => {
  await withHubFixture({
    arrangements: [
      { oplocId: "oploc:missing", serviceLabel: "Delivered-In", lifecycleState: "active" },
      { oplocId: "oploc:cycle-a", serviceLabel: "Delivered-In", lifecycleState: "active" },
      { oplocId: "oploc:current", serviceLabel: "Delivered-In", lifecycleState: "active" },
    ],
    oplocs: [{ canonicalId: "oploc:current", label: "Current Site" }],
    oplocRedirects: { "oploc:missing": "oploc:not-listed", "oploc:cycle-a": "oploc:cycle-b", "oploc:cycle-b": "oploc:cycle-a" },
  }, async () => {
    const result = await readDeliveredInOplocs(request());
    assert.deepEqual(result, [{ canonicalId: "oploc:current", label: "Current Site", legacyIds: [] }]);
  });
});
