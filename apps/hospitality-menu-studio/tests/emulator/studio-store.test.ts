import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { studioHandlers } from "../../lib/http";
import type { Dish, Menu } from "../../lib/contract";
import { StudioStore } from "../../lib/store";

test("Studio saves immutable revisions, rejects a stale writer and coalesces an exact retry", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const store = new StudioStore(db, () => new Date("2026-11-18T12:00:00.000Z"));
  const url = "http://localhost:13686/api/studio";
  let actor = { id: "actor-one", name: "Reviewer One", canManage: true, canPublish: false };
  const handlers = studioHandlers(async () => actor, () => store, () => {});
  const post = (item: Dish) => handlers.POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "save-dish", item }),
  }));
  const dish: Dish = {
    id: randomUUID(), version: 0, name: "Fixture dish", category: "other", temperature: null,
    customerDescription: "", kitchenDescription: "", assortment: { expectedTotal: 24, unit: "pieces", components: [] }, updatedAt: "",
  };
  try {
    const results = await Promise.all([post(dish), post(dish)]);
    for (const result of results) {
      assert.equal(result.status, 200);
      assert.equal((await result.json() as { item: Dish }).item.version, 1);
    }
    const saved = await store.read<Dish>("dishes", dish.id);
    assert.equal(saved.updatedAt, "2026-11-18T12:00:00.000Z");
    const concurrent = await Promise.all([post({ ...saved, name: "Edit A" }), post({ ...saved, name: "Edit B" })]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    const head = await store.read<Dish>("dishes", dish.id);
    assert.equal(head.version, 2);
    assert.equal((await post(head)).status, 200);
    assert.equal((await store.read<Dish>("dishes", dish.id)).version, 2);
    const menu: Menu = {
      id: randomUUID(), version: 0, name: "Fixture season", kind: "seasonal", updatedAt: "",
      startDate: "2026-11-30", endDate: "2027-02-28", anchorMonday: "2026-11-30",
      sections: [{
        id: "section-1", name: "Section", catalogueItemId: "", mode: "rotation",
        staticDishIds: [], weeks: [[dish.id], [], [dish.id], [], [], []],
      }],
    };
    const savedMenu = await handlers.POST(new Request(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save-menu", item: menu }),
    }));
    assert.equal(savedMenu.status, 200);
    assert.deepEqual((await store.read<Menu>("menus", menu.id)).sections, menu.sections);
    const preview = await handlers.GET(new Request(url + "?menuId=" + menu.id + "&eventDate=2027-01-11"));
    assert.equal(preview.status, 200);
    assert.deepEqual((await preview.json()).items[0].dishes.map((candidate: Dish) => candidate.id), [dish.id]);
    actor = { ...actor, id: "read-only", canManage: false };
    assert.equal((await post({ ...head, name: "Rejected change" })).status, 403);
    const revisions = db.collection("fikaHospitalityMenuStudioV1_dishes").doc(dish.id).collection("revisions");
    assert.equal((await revisions.count().get()).data().count, 2);
    assert.equal((await revisions.doc("1").get()).get("item.name"), "Fixture dish");
    assert.equal((await revisions.doc("2").get()).get("actorId"), "actor-one");
    assert.equal((await handlers.GET(new Request(`${url}?dishId=${dish.id}`))).headers.get("cache-control"), "private, no-store");
  } finally {
    await deleteApp(app);
  }
});
