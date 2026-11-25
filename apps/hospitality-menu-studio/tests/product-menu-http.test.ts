import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { productMenuHandlers } from "../lib/product-menu-http";

test("the draft endpoint never opens storage for an unverified catalogue or a publication command", async () => {
  const url = "http://localhost:13686/api/studio/product-menus";
  let source: CatalogueLoadResult["source"] = "cache-unverified";
  let opened = 0;
  const handlers = productMenuHandlers({
    authorise: async () => ({ id: "test-manager", name: "Manager", canManage: true, canPublish: true }),
    readCatalogue: async () => ({ source, contentHash: "a".repeat(64), generatedAt: "2026-11-25T11:00:00.000Z", downloaded: false, notes: [],
      catalogue: { contract: "catalogue-test", schemaVersion: 2, items: [], exceptions: [], oplocs: [] } }),
    assertOrigin: () => {},
    store: () => { opened++; throw new Error("The draft store must remain closed."); },
  });
  const post = (body: unknown) => handlers.POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const failedCatalogue = await handlers.GET(new Request(url));
  assert.equal(failedCatalogue.status, 503);
  assert.equal((await failedCatalogue.json()).code, "CATALOGUE_UNAVAILABLE");
  assert.equal((await post({ action: "create", itemId: "item:one", setup: { kind: "fixed" } })).status, 503);
  source = "network";
  assert.equal((await post({ action: "publish", itemId: "item:one" })).status, 422);
  assert.equal((await post({ action: "create", itemId: "item:one", setup: { kind: "fixed" }, price: 15 })).status, 422);
  assert.equal((await handlers.GET(new Request(url + "?itemId=item:one&itemId=item:two"))).status, 422);
  assert.equal(opened, 0);
});
