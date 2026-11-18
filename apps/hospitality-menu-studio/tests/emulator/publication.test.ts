import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { CATALOGUE_PACKAGE_CONTRACT } from "@fika/server-shared/hospitality-effective-offering";
import {
  studioDishReviewKey, studioDishReviewRecords, studioDishSafetyFences, studioDishSignatureRoles, type StudioDishSafetyFence,
} from "../../../shared/hospitality-menu-studio-safety";
import type { Dish, Menu, Review } from "../../lib/contract";
import { studioHandlers } from "../../lib/http";
import { publicationHash } from "../../lib/publication";
import { StudioStore } from "../../lib/store";

test("content publication freezes current menu, dish and signed evidence with an idempotent receipt", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const now = new Date("2026-11-18T12:00:00.000Z");
  const store = new StudioStore(db, () => now);
  const itemId = "hospitality-menu-item:synthetic";
  const dish: Dish = { id: randomUUID(), version: 0, name: "Synthetic pastries", category: "other", temperature: null, updatedAt: "",
    customerDescription: "Assorted pastries", kitchenDescription: "Pack 12 of each in a box.", assortment: { expectedTotal: 24, unit: "pieces",
      components: [{ id: "plain", name: "Plain", quantity: 12 }, { id: "fruit", name: "Fruit", quantity: 12 }] } };
  const menu: Menu = { id: randomUUID(), version: 0, kind: "seasonal", name: "Synthetic winter menu", startDate: "2026-11-18",
    endDate: "2027-01-15", anchorMonday: "", updatedAt: "", sections: [{ id: "synthetic", name: "Baking", catalogueItemId: itemId,
      mode: "static", staticDishIds: [dish.id], weeks: [[], [], [], [], [], []] }] };
  let actor = { id: "synthetic-author", name: "Test author", canManage: true, canPublish: true };
  let catalogueHash = "a".repeat(64);
  let advisory: Review["impact"] = { status: "available", coverage: "partial", reasons: ["BOOKING_WINDOW_TRUNCATED"], bookings: [] };
  const handlers = studioHandlers(async () => actor, () => store, () => {}, async () => ({
    source: "network", contentHash: catalogueHash, generatedAt: now.toISOString(), downloaded: true, notes: [],
    catalogue: { contract: CATALOGUE_PACKAGE_CONTRACT, schemaVersion: 2, exceptions: [], oplocs: [],
      items: [{ id: itemId, name: "Synthetic item", category: "Hospitality", defaultPrices: [{ amount: 1, vatRate: 0, from: "2026-01-01" }], dietaryInformation: [], allergenInformation: [] }] },
  }), () => true, undefined, async (_request, target) => {
    assert.deepEqual(target.catalogueItemIds, [itemId]);
    return advisory;
  });
  const url = "http://localhost:13686/api/studio";
  const post = (body: unknown) => handlers.POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const head = db.collection("fikaHospitalityMenuStudioV1_menus").doc(menu.id);
  const schedule = db.collection("fikaHospitalityMenuStudioV1_schedules").doc("company");
  const effectiveDate = "2026-12-01";
  const action = { menuId: menu.id, version: 1, effectiveDate, scope: {} };
  const readReview = async (input = action): Promise<Review> => {
    const response = await post({ ...input, action: "review" });
    assert.equal(response.status, 200);
    return response.json();
  };
  const publish = (reviewToken: string, input = action) => post({ ...input, action: "publish", confirmed: true, reviewToken });
  const status = db.collection(studioDishSafetyFences).doc(studioDishReviewKey(dish.id, 1));
  let createdSchedule = false;
  try {
    assert.equal((await schedule.get()).exists, false, "use an isolated Studio publication emulator");
    const firstDish = await store.save("dishes", actor.id, dish);
    await store.save("menus", actor.id, menu);
    const unchecked = await readReview();
    assert.equal(unchecked.canPublish, false);
    assert.equal(unchecked.reviewToken, null);
    const subject = await store.requestDishReview(dish.id, 1, actor.id);
    const reader = db.collection(studioDishReviewRecords).doc(status.id);
    // Synthetic CPU records here exercise Studio's verification and transaction. The CPU route emulator tests exercise signer writes.
    const evidence: StudioDishSafetyFence = { contract: "cpu-production.studio-dish-safety.v1", subject, status: "current",
      releaseId: "cpu-studio-dish-release:" + status.id + ":v1", matrixHash: "b".repeat(64), changedAt: now.toISOString() };
    const signatures = studioDishSignatureRoles.map((role, index) => ({ role, actorId: "synthetic-chef-" + index,
      eventId: randomUUID(), signedAt: now.toISOString(), matrixHash: evidence.matrixHash, sourceHash: subject.sourceHash, signatureHash: "c".repeat(64) }));
    await reader.collection("releases").doc("1").create({ ...evidence, signatures });
    await Promise.all(signatures.map(signature => reader.collection("events").doc(signature.eventId).create({ ...signature, source: "cpu-production", action: "sign" })));
    await status.create(evidence);

    const ready = await readReview();
    assert.equal(ready.canPublish, true);
    assert.equal(ready.safety.status, "verified");
    assert.deepEqual(ready.impact, advisory);
    assert.match(ready.issues.join(" "), /Additional bookings may be affected/);
    assert.equal((await readReview({ ...action, scope: { sectionId: "synthetic" } })).canPublish, false);
    const token = ready.reviewToken!;
    actor = { ...actor, id: "second-test-author", canPublish: false };
    assert.equal((await publish(token)).status, 403);
    actor = { ...actor, canPublish: true };
    assert.equal((await publish(token)).status, 409, "review token binds the publishing person");
    actor = { ...actor, id: "synthetic-author" };
    catalogueHash = "f".repeat(64);
    assert.equal((await publish(token)).status, 409, "catalogue change requires a fresh review");
    catalogueHash = "a".repeat(64);
    await status.update({ status: "revoked" });
    assert.equal((await publish(token)).status, 409, "revocation fences publication");
    await status.update({ status: "current" });
    assert.equal((await head.collection("publications").get()).size, 0);

    advisory = { status: "unavailable" };
    assert.equal((await publish(token)).status, 409, "unavailable impact is recorded distinctly from partial data");
    const accepted = await readReview();
    assert.equal(accepted.impact.status, "unavailable");
    const results = await Promise.all([publish(accepted.reviewToken!), publish(accepted.reviewToken!)]);
    for (const response of results) assert.equal(response.status, 200);
    const first = (await results[0].json()).publication;
    createdSchedule = true;
    assert.deepEqual((await results[1].json()).publication, first);
    assert.equal(first.revision, 1);
    assert.equal(first.effectiveDate, effectiveDate);
    const data = (await head.collection("publicationPackages").doc(first.id).get()).data()!;
    assert.equal(publicationHash(data.body), first.contentHash);
    const payload = JSON.parse(data.body);
    assert.equal(payload.projectId, "demo-fika-os");
    assert.equal(payload.dishes[0].dish.kitchenDescription, dish.kitchenDescription);
    assert.deepEqual(payload.dishes[0].safety, { subject, releaseId: evidence.releaseId, matrixHash: evidence.matrixHash });
    assert.equal((await head.collection("publicationOutbox").doc(first.id).get()).data()?.impact.status, "unavailable");
    assert.equal((await post({ action: "activate-collection", menuId: menu.id, publicationId: first.id, visibility: "customer", confirmed: true })).status, 503);

    const competing = await store.save("menus", actor.id, { ...menu, id: randomUUID() });
    const overlap = await readReview({ ...action, menuId: competing.id });
    assert.match(overlap.issues.join(" "), /overlaps an existing company menu/);
    assert.equal(overlap.canPublish, false);

    const savedMenu = await store.read<Menu>("menus", menu.id);
    const amendedMenu = await store.save("menus", actor.id, { ...savedMenu, name: "Synthetic winter menu amendment" });
    const amendment = { ...action, version: amendedMenu.version, effectiveDate: "2027-01-01" };
    const reviewedAmendment = await readReview(amendment);
    assert.match(reviewedAmendment.changes.join(" "), /Menu name changed/);
    const amendmentResponse = await publish(reviewedAmendment.reviewToken!, amendment);
    assert.equal(amendmentResponse.status, 200);
    const second = (await amendmentResponse.json()).publication;
    assert.equal(second.revision, 2);
    assert.equal(JSON.parse((await head.collection("publicationPackages").doc(second.id).get()).data()!.body).previousPublicationId, first.id);

    await store.save("dishes", actor.id, { ...firstDish, kitchenDescription: "Revised packing instructions." });
    assert.equal((await readReview(amendment)).safety.status, "unverified");
    const replay = await publish(accepted.reviewToken!);
    assert.deepEqual((await replay.json()).publication, first);
    assert.equal((await head.collection("publications").get()).size, 2);
    assert.deepEqual((await head.collection("publicationPackages").doc(first.id).get()).data(), data);
  } finally {
    if (createdSchedule) await schedule.delete();
    await deleteApp(app);
  }
});
