import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { DraftVersion, Menu } from "../../lib/contract";
import { studioHandlers } from "../../lib/http";
import { StudioStore } from "../../lib/store";

test("historical menu restore appends an audited draft revision and rejects stale or unauthorized commands", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const store = new StudioStore(getFirestore(app));
  const url = "http://127.0.0.1:13686/api/studio";
  const id = randomUUID();
  let actor = { id: "editor-one", name: "Test editor", canManage: true, canPublish: false };
  const handlers = studioHandlers(async () => actor, () => store, () => {});
  const post = (command: unknown) => handlers.POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
  }));
  const get = (query: string) => handlers.GET(new Request(url + "?" + query));
  const menu: Menu = {
    id, version: 0, name: "Earlier draft", kind: "seasonal", updatedAt: "",
    startDate: "2026-11-30", endDate: "2027-02-28", anchorMonday: "", sections: [],
  };
  try {
    const created = await store.save("menus", actor.id, menu);
    const edited = await store.save("menus", actor.id, { ...created, name: "Edited draft" });
    const restore = { action: "restore-draft", menuId: id, version: edited.version, sourceVersion: created.version, confirmed: true };
    assert.equal((await post({ ...restore, confirmed: false })).status, 422);
    const results = await Promise.all([post(restore), post(restore)]);
    for (const result of results) {
      assert.equal(result.status, 200);
      const { item, restoredVersion } = await result.json() as { item: Menu; restoredVersion: number };
      assert.equal(item.version, 3);
      assert.equal(restoredVersion, 3);
      assert.equal(item.name, "Earlier draft");
    }
    const page = await get("list=versions&menuId=" + id);
    assert.equal(page.status, 200);
    const { items } = await page.json() as { items: DraftVersion[] };
    assert.deepEqual(items.map(item => [item.version, item.restoredFromVersion]), [[3, 1], [2, undefined], [1, undefined]]);
    assert.equal(items[0].actorId, "editor-one");
    const comparison = await get("menuId=" + id + "&fromVersion=2&toVersion=3");
    assert.deepEqual(await comparison.json(), { changes: ["Menu name changed."] });
    assert.equal((await store.readMenuRevision(id, 2)).name, "Edited draft");

    const next = await store.save("menus", "editor-two", { ...created, version: 3, name: "New edit after restore" });
    const replay = await post(restore);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { item: next, restoredVersion: 3 });
    actor = { ...actor, id: "editor-two" };
    assert.equal((await post(restore)).status, 409);
    actor = { ...actor, canManage: false };
    assert.equal((await post({ ...restore, version: 4 })).status, 403);
    assert.equal((await store.read<Menu>("menus", id)).version, 4);
    assert.deepEqual(await (await get("list=history&menuId=" + id)).json(), { items: [], nextCursor: null });
  } finally {
    await deleteApp(app);
  }
});
