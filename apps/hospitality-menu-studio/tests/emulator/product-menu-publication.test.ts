import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import {
  decodeStudioProductPublication, studioProductMenuId,
} from "../../../shared/hospitality-menu-studio-product-publication";
import {
  studioDishReviewKey, studioDishReviewSubject, type StudioDishReviewSubject, type StudioDishSafetyFence,
} from "../../../shared/hospitality-menu-studio-safety";
import type { Dish, StudioActor } from "../../lib/contract";
import type { DishSafety } from "../../lib/publication";
import { StudioStore } from "../../lib/store";

test("Studio product publication requires exact CPU evidence and preserves the same immutable package on delivery retry", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const now = () => new Date("2026-11-25T11:00:00.000Z");
  const studio = new StudioStore(db, now);
  const itemId = `item:${randomUUID()}`;
  const productMenus = studio.productMenus();
  const publications = studio.productPublications();
  const actor: StudioActor = { id: "test-editor", name: "Test editor", canManage: true, canPublish: true,
    publicationPilot: { publish: true, activateSeasonal: false, activateCollection: false, activateProduct: false, oplocId: "fixture-site", menuId: studioProductMenuId(itemId),
      firstDate: "2026-11-25", lastDate: "2026-12-31", generation: 0 } };
  const catalogue: CatalogueLoadResult = {
    source: "network", contentHash: "a".repeat(64), downloaded: true, notes: [], generatedAt: now().toISOString(),
    catalogue: { contract: "catalogue-test", schemaVersion: 2, exceptions: [], oplocs: [], items: [
      { id: itemId, name: "Finger Food fixture", category: "Hospitality", defaultPrices: [], dietaryInformation: [], allergenInformation: [] },
    ] },
  };
  const signingKey = "b".repeat(64);
  const effectiveDate = "2026-11-30";
  const draft = await productMenus.createOrOpen(actor.id, itemId, { kind: "fixed" });
  const dish = await studio.save<Dish>("dishes", actor.id, {
    id: randomUUID(), version: 0, updatedAt: "", category: "other", temperature: null, name: "Original dish",
    customerDescription: "Customer copy", kitchenDescription: "Private fixture copy", assortment: null,
  });
  const amended = await studio.save<Dish>("dishes", actor.id, { ...dish, name: "New dish revision" });
  const saved = await productMenus.save(actor.id, { ...draft, configuration: { presentation: "quantities", groups: [],
    schedule: { kind: "fixed", choices: { groups: [], dishes: [{ dishId: dish.id, revision: dish.version }] } },
  } });
  const request = { itemId, version: saved.version, effectiveDate };
  const subject = studioDishReviewSubject(dish);
  const fence: StudioDishSafetyFence = {
    contract: "cpu-production.studio-dish-safety.v1", status: "current", subject,
    releaseId: `cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v1`, matrixHash: "c".repeat(64), changedAt: now().toISOString(),
  };
  let current: DishSafety = { status: "unverified" };
  const evidence = { actor, catalogue, signingKey, safety: async (expected: StudioDishReviewSubject) => {
    assert.deepEqual(expected, subject);
    return current;
  } };
  try {
    await assert.rejects(publications.review({ ...request, effectiveDate: "2027-01-01" }, evidence), /outside your approved publication scope/);
    const unsigned = await publications.review(request, evidence);
    assert.equal(unsigned.reviewToken, null);
    assert.match(unsigned.issues.join(), /signed CPU allergen evidence/);
    current = { status: "verified", fence: { ...fence, subject: studioDishReviewSubject(amended) } };
    assert.equal((await publications.review(request, evidence)).reviewToken, null);
    current = { status: "verified", fence };
    const review = await publications.review(request, evidence);
    assert.deepEqual(review.issues, []);
    const command = { ...request, reviewToken: review.reviewToken!, confirmed: true as const };
    const changedEvidence = { ...evidence, actor: { ...actor, id: "different-editor" } };
    await assert.rejects(publications.publish(command, changedEvidence, async () => assert.fail("must not deliver")), /evidence changed/);
    current = { status: "revoked", fence: { ...fence, status: "revoked" } };
    await assert.rejects(publications.publish(command, evidence, async () => assert.fail("must not deliver")), /evidence changed/);
    current = { status: "verified", fence };
    let deliveredHash: string | undefined;
    await assert.rejects(publications.publish(command, evidence, async ({ manifest, body }) => {
      const packageData = decodeStudioProductPublication(body, manifest, "demo-fika-os");
      assert.equal(packageData?.dishes[0].dish.name, "Original dish");
      assert.equal(packageData?.configuration.schedule.kind, "fixed");
      deliveredHash = manifest.contentHash;
      throw Error("delivery not acknowledged");
    }), /delivery not acknowledged/);
    const publication = await publications.publish(command, evidence, async ({ manifest }) => {
      assert.equal(manifest.contentHash, deliveredHash);
    });
    assert.deepEqual(await publications.publish(command, evidence, async () => assert.fail("already delivered")), publication);
    let listing = await productMenus.list(new Set([itemId]));
    assert.equal(listing.items[0]?.publicationStatus, "published");
    assert.equal(listing.items[0]?.hasPublishedRevision, true);
    const edited = await productMenus.save(actor.id, { ...saved, configuration: { ...saved.configuration, presentation: "dropdown" } });
    listing = await productMenus.list(new Set([itemId]));
    assert.equal(listing.items[0]?.version, edited.version);
    assert.equal(listing.items[0]?.publicationStatus, "draft");
    assert.equal(listing.items[0]?.hasPublishedRevision, true);
    const head = db.collection("fikaHospitalityMenuStudioV1_productMenus").doc(itemId);
    const summary = (await head.get()).get("summary");
    await head.update({ summary: { ...summary, version: 1 } });
    listing = await productMenus.list(new Set([itemId]));
    assert.equal(listing.items[0]?.publicationStatus, "unavailable", "a publication newer than the listed draft has invalid lineage");
    await head.update({ summary });
    await head.collection("productPublicationPackages").doc(publication.id).update({ body: "{}" });
    listing = await productMenus.list(new Set([itemId]));
    assert.equal(listing.items[0]?.publicationStatus, "unavailable");
    assert.deepEqual(await productMenus.read(itemId), edited);
    const published = await db.collection("fikaHospitalityMenuStudioV1_productMenus").doc(itemId).collection("productPublicationPackages").get();
    assert.equal(published.size, 1);
  } finally { await deleteApp(app); }
});
