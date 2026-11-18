import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  studioDishReviewKey, studioDishReviewRecords, studioDishReviewRequests, studioDishSafetyFences, studioDishSignatureRoles,
  type StudioDishReviewRequest, type StudioDishSafetyFence,
} from "../../../shared/hospitality-menu-studio-safety";
import type { Dish, Menu } from "../../lib/contract";
import { studioHandlers } from "../../lib/http";
import { StudioStore } from "../../lib/store";

test("Studio submits only a saved exact dish revision and verifies the CPU release header", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const store = new StudioStore(db);
  const url = "http://localhost:13686/api/studio";
  const actor = { id: "test-studio-author", name: "Studio Author", canManage: true, canPublish: true };
  const handlers = studioHandlers(async () => actor, () => store, () => {}, undefined, () => true, () => "http://127.0.0.1:13486");
  const disabled = studioHandlers(async () => actor, () => store, () => {});
  const dish: Dish = { id: randomUUID(), version: 0, name: "Synthetic test dish", category: "other", temperature: null,
    customerDescription: "Customer description", kitchenDescription: "Exact kitchen description", assortment: null, updatedAt: "" };
  const submit = (version: number, handler = handlers) => handler.POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "submit-dish-review", dishId: dish.id, version, confirmed: true }),
  }));
  const statusFor = (version: number) => handlers.GET(new Request(url + "?dishId=" + dish.id + "&reviewVersion=" + version));
  const key = studioDishReviewKey(dish.id, 1);
  const source = db.collection(studioDishReviewRequests).doc(key);
  const fence = db.collection(studioDishSafetyFences).doc(key);
  const release = db.collection(studioDishReviewRecords).doc(key).collection("releases").doc("1");
  try {
    const first = await store.save("dishes", actor.id, dish);
    assert.equal((await submit(1, disabled)).status, 503);
    assert.equal((await source.get()).exists, false);
    assert.equal((await (await statusFor(1)).json()).status, "unverified");
    const [a, b] = await Promise.all([submit(1), submit(1)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const handoff = await a.json();
    assert.deepEqual(await b.json(), handoff);
    assert.equal(handoff.checkerPath, "/allergens/studio/" + dish.id + "/1");
    assert.equal(handoff.checkerUrl, "http://127.0.0.1:13486" + handoff.checkerPath);
    const saved = (await source.get()).data() as StudioDishReviewRequest;
    assert.equal(saved.dish.kitchenDescription, dish.kitchenDescription);
    assert.equal(saved.requestedBy, actor.id);
    assert.equal((await (await statusFor(1)).json()).status, "in_review");

    // Synthetic provider fixture. The CPU route emulator tests exercise the actual dual signature write.
    const evidence: StudioDishSafetyFence = { contract: "cpu-production.studio-dish-safety.v1", subject: saved.subject,
      status: "current", releaseId: "cpu-studio-dish-release:" + key + ":v1", matrixHash: "b".repeat(64), changedAt: first.updatedAt };
    await fence.create(evidence);
    assert.equal((await (await statusFor(1)).json()).status, "unavailable");
    const signatures = studioDishSignatureRoles.map((role, index) => ({ role, actorId: "reviewer-" + index,
      eventId: randomUUID(), signedAt: first.updatedAt, matrixHash: evidence.matrixHash, sourceHash: saved.subject.sourceHash,
      signatureHash: "c".repeat(64) }));
    await release.create({ ...evidence, signatures: [signatures[0]] });
    assert.equal((await (await statusFor(1)).json()).status, "unavailable");
    await release.update({ signatures });
    assert.equal((await (await statusFor(1)).json()).status, "unavailable");
    const events = release.parent.parent!.collection("events");
    await Promise.all(signatures.map(signature => events.doc(signature.eventId).create({ ...signature, action: "sign", source: "cpu-production" })));
    const verified = await (await statusFor(1)).json();
    assert.deepEqual(verified, { status: "verified", fence: evidence });
    await fence.update({ status: "revoked" });
    assert.equal((await (await statusFor(1)).json()).status, "revoked");
    const second = await store.save("dishes", actor.id, { ...first, kitchenDescription: "Revised kitchen instructions" });
    assert.equal(second.version, 2);
    assert.equal((await statusFor(1)).status, 409);
    assert.equal((await submit(1)).status, 409);
    assert.equal((await (await statusFor(2)).json()).status, "unverified");
    assert.deepEqual((await source.get()).data(), saved);

    const pendingMenu: Menu = { id: randomUUID(), version: 0, name: "Synthetic menu", kind: "seasonal",
      startDate: "2099-01-01", endDate: "2099-12-31", anchorMonday: "", updatedAt: "",
      sections: [{ id: "test-section", name: "Section", catalogueItemId: "test-item", mode: "static", staticDishIds: [dish.id], weeks: [[], [], [], [], [], []] }] };
    const menu = await store.save("menus", actor.id, pendingMenu);
    const review = await handlers.POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "review", menuId: menu.id, version: menu.version, effectiveDate: menu.startDate, scope: {} }) }));
    assert.equal(review.status, 200);
    assert.deepEqual((await review.json()).safety, { status: "unverified" });
  } finally {
    await deleteApp(app);
  }
});
