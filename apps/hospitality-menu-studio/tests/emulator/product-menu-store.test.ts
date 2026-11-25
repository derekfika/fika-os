import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { ProductMenuDraft } from "../../../shared/hospitality-menu-studio-product-content";
import type { Dish, Menu } from "../../lib/contract";
import { productMenuHandlers } from "../../lib/product-menu-http";
import { StudioProblem } from "../../lib/problem";
import { StudioStore } from "../../lib/store";

test("canonical product drafts coalesce creation, retain exact dish revisions and coexist with legacy menus", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const versionTime = new Date("2026-11-25T11:00:00.000Z");
  const studio = new StudioStore(db, () => versionTime);
  const itemId = `item:${randomUUID()}`;
  const url = "http://localhost:13686/api/studio/product-menus";
  let catalogueItems = [{ id: itemId, name: "Product", category: "Hospitality", defaultPrices: [], dietaryInformation: [], allergenInformation: [] }];
  let actor = { id: "test-author", name: "Test author", canManage: true, canPublish: false };
  const handlers = productMenuHandlers({
    authorise: async () => actor,
    readCatalogue: async () => ({ source: "network", contentHash: "a".repeat(64), generatedAt: versionTime.toISOString(), downloaded: true, notes: [],
      catalogue: { contract: "catalogue-test", schemaVersion: 2, items: catalogueItems, exceptions: [], oplocs: [] } }),
    assertOrigin: request => {
      if (request.headers.get("origin") !== new URL(url).origin) throw new StudioProblem(403, "STUDIO_ORIGIN_DENIED", "Invalid origin.");
    },
    store: () => studio.productMenus(),
  });
  const get = (query = "") => handlers.GET(new Request(url + query));
  const post = (body: unknown, origin = new URL(url).origin) => handlers.POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  }));
  const create = { action: "create", itemId, setup: { kind: "rotation", anchorMonday: "2026-11-30", cycleWeeks: 2 } };

  try {
    const legacy = await studio.save<Menu>("menus", actor.id, { id: randomUUID(), version: 0, updatedAt: "", kind: "seasonal", name: "Legacy season",
      startDate: "2026-11-30", endDate: "2027-02-28", anchorMonday: "2026-11-30",
      sections: [{ id: "legacy-section", name: "Legacy menu section", catalogueItemId: itemId, mode: "static",
        staticDishIds: [], weeks: [[], [], [], [], [], []] }] });
    const dish = await studio.save<Dish>("dishes", actor.id, { id: randomUUID(), version: 0, updatedAt: "", name: "Dish",
      category: "other", temperature: null, customerDescription: "Customer copy", kitchenDescription: "Private copy", assortment: null });
    await studio.save<Dish>("dishes", actor.id, { ...dish, name: "New revision" });

    const before = await get(`?itemId=${itemId}`);
    assert.deepEqual(await before.json(), { item: null });
    assert.equal(before.headers.get("cache-control"), "private, no-store");
    assert.equal(await studio.productMenus().read(itemId), null);
    assert.equal((await post(create, "https://other.invalid")).status, 403);
    assert.equal((await post({ ...create, itemId: "not-a-canonical-item" })).status, 404);
    assert.equal((await post({ ...create, setup: { ...create.setup, cycleWeeks: 0 } })).status, 422);

    const created = await Promise.all([post(create), post(create)]);
    assert.deepEqual(created.map(response => response.status), [200, 200]);
    const [{ item }, replay] = await Promise.all(created.map(response => response.json())) as [{ item: ProductMenuDraft }, unknown];
    assert.deepEqual(replay, { item });
    assert.equal(item.version, 1);
    assert.equal(item.itemId, itemId);
    assert.deepEqual((await (await post({ ...create, setup: { kind: "fixed" } })).json()).item, item);
    assert.equal(item.configuration.schedule.kind, "rotation");

    const changed: ProductMenuDraft = { ...item, configuration: { ...item.configuration, presentation: "checkboxes",
      schedule: { kind: "fixed", choices: { groups: [], dishes: [{ dishId: dish.id, revision: 1 }] } } } };
    const change = { action: "save", item: changed };
    const racing = await Promise.all([post(change), post({ ...change, item: { ...changed, configuration: { ...changed.configuration, presentation: "dropdown" } } })]);
    assert.deepEqual(racing.map(response => response.status).sort(), [200, 409]);
    const winner = (await racing.find(response => response.ok)!.json()).item as ProductMenuDraft;
    assert.equal(winner.version, 2);
    const archivedDishes = await get("?dishRevisions=" + encodeURIComponent(`${dish.id}@1,${dish.id}@3,${dish.id}@2`));
    assert.equal(archivedDishes.status, 200);
    assert.equal(archivedDishes.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await archivedDishes.json(), { items: [
      { id: dish.id, version: 1, name: "Dish", category: "other", customerDescription: "Customer copy" },
      { id: dish.id, version: 2, name: "New revision", category: "other", customerDescription: "Customer copy" },
    ] });
    const retry = await post({ ...change, item: { ...item, configuration: winner.configuration } });
    assert.deepEqual(await retry.json(), { item: winner });
    const missingRevision: ProductMenuDraft = { ...winner, configuration: { ...winner.configuration,
      schedule: { kind: "fixed", choices: { groups: [], dishes: [{ dishId: dish.id, revision: 3 }] } } } };
    assert.equal((await post({ action: "save", item: missingRevision })).status, 422);
    assert.deepEqual(await studio.productMenus().read(itemId), winner);
    assert.deepEqual(await studio.read<Menu>("menus", legacy.id), legacy);
    assert.equal((await studio.read<Dish>("dishes", dish.id)).version, 2);

    actor = { ...actor, canManage: false };
    assert.equal((await post(create)).status, 403);
    assert.deepEqual(await (await get(`?itemId=${itemId}`)).json(), { item: winner });
    assert.deepEqual(await (await get()).json(), { items: [{ itemId, updatedAt: winner.updatedAt, version: 2, kind: "fixed", dishCount: 1 }], nextCursor: null });
    catalogueItems = [];
    assert.equal((await get(`?itemId=${itemId}`)).status, 404);
    assert.deepEqual((await (await get()).json()).items, []);
    const revisions = db.collection("fikaHospitalityMenuStudioV1_productMenus").doc(itemId).collection("revisions");
    const audit = await revisions.orderBy("item.version").get();
    assert.deepEqual(audit.docs.map(revision => [revision.get("item.version"), revision.get("actorId"), revision.get("baseVersion")]),
      [[1, actor.id, 0], [2, actor.id, 1]]);
  } finally {
    await deleteApp(app);
  }
});
