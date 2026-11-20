import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase-admin/app";
import {
  studioDishReviewKey, studioDishReviewRecords, studioDishReviewSubject, studioDishSafetyFences, studioDishSignatureRoles,
} from "../../../shared/hospitality-menu-studio-safety";
import {
  canonicalJson, publicationHash, publicationIdFor, type PublicationPackage,
} from "../../../shared/hospitality-menu-studio-publication";
import { HubStudioPublications, type ActivationCommand } from "../../lib/hospitality-studio-publications";

const enabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const now = "2026-11-20T12:00:00.000Z";

function publication(menuId: string, itemId: string, revision = 1, kind: "seasonal" | "collection" = "seasonal") {
  const dishes = Array.from({ length: 2 }, (_, index) => {
    const dish = { id: `dish:${menuId}:${index}`, version: revision, name: `Synthetic dish ${index}`, category: "other" as const,
      updatedAt: now, temperature: "cold" as const, customerDescription: "Customer copy", kitchenDescription: "Private kitchen instructions",
      assortment: { expectedTotal: 24, unit: "pieces", components: [{ id: "fixture:piece", name: "One piece", quantity: 24 }] } };
    const subject = studioDishReviewSubject(dish);
    return { dish, safety: { subject, matrixHash: "d".repeat(64), releaseId: `cpu-studio-dish-release:${studioDishReviewKey(dish.id, revision)}:v1` } };
  });
  const payload: PublicationPackage = {
    contract: "hospitality-menu-studio.publication.v1", projectId: "demo-fika-os", sourceApp: "hospitality-menu-studio",
    publicationId: publicationIdFor(menuId, revision), publicationRevision: revision, sourceDraftVersion: revision,
    previousPublicationId: revision === 1 ? null : publicationIdFor(menuId, revision - 1),
    effectiveDate: revision === 1 ? "2027-03-22" : "2027-04-05", catalogueHash: "a".repeat(64),
    menu: { id: menuId, version: revision, name: "Fictional seasonal menu", kind, startDate: "2027-03-22", endDate: "2027-05-17",
      updatedAt: now, anchorMonday: "2027-03-22", sections: [{ id: "test:section", catalogueItemId: itemId, name: "Synthetic choices",
        mode: "rotation", staticDishIds: [], weeks: [0, 1, 0, 1, 0, 1].map(index => [dishes[index].dish.id]) }] },
    dishes,
  };
  const create = () => {
    const body = canonicalJson(payload);
    return { manifest: { id: payload.publicationId, menuId, menuName: payload.menu.name, revision, effectiveDate: payload.effectiveDate,
      publishedAt: now, publishedBy: "synthetic-publisher", scope: {}, sourceDraftVersion: revision, contentHash: publicationHash(body) }, body };
  };
  return { create, payload };
}

async function seedSafety(db: ReturnType<typeof getFirestore>, payload: PublicationPackage) {
  const batch = db.batch();
  const fences = payload.dishes.map(({ safety }) => {
    const { subject, releaseId, matrixHash } = safety;
    const key = studioDishReviewKey(subject.dishId, subject.revision);
    const record = db.collection(studioDishReviewRecords).doc(key);
    const ref = db.collection(studioDishSafetyFences).doc(key);
    const fence = { contract: "cpu-production.studio-dish-safety.v1", subject, releaseId, matrixHash, status: "current", changedAt: now };
    const signatures = studioDishSignatureRoles.map((role, index) => ({ role, actorId: `fixture-signer-${index}`, eventId: randomUUID(),
      signedAt: now, matrixHash, sourceHash: subject.sourceHash, signatureHash: "b".repeat(64) }));
    batch.create(ref, fence);
    batch.create(record.collection("releases").doc("1"), { ...fence, signatures });
    for (const signature of signatures) batch.create(record.collection("events").doc(signature.eventId), { ...signature, action: "sign", source: "cpu-production" });
    return ref;
  });
  await batch.commit();
  return fences;
}

test("emulator: Hub needs explicit site activation and resolves the current signed publication by London event date", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const hub = new HubStudioPublications(db, "demo-fika-os");
  const id = randomUUID();
  const site = `oploc:${id}`;
  const item = `hospitality-menu-item:${id}`;
  const first = publication(id, item);
  const second = publication(id, item, 2);
  const input = first.create();
  const command: ActivationCommand = { publicationId: input.manifest.id, oplocId: site, expectedGeneration: 0,
    commandId: randomUUID(), confirmed: true, action: "activate-seasonal", visibility: "customer", reason: "Isolated fictional scope" };
  const authorise = async () => "fixture-activator";
  const validateCatalogue = async (_: unknown, oplocId: string, itemIds: readonly string[]) => {
    assert.equal(oplocId, site);
    assert.deepEqual(itemIds, [item]);
  };
  const choices = (at: string, oplocId = site) => db.runTransaction(tx => hub.choices(tx, oplocId, at, [item]), { readOnly: true });
  try {
    await assert.rejects(hub.register({ ...input, body: input.body + " " }), { code: "STUDIO_PUBLICATION_INTEGRITY" });
    await assert.rejects(hub.register({ ...input, manifest: { ...input.manifest, revision: 2 } }), { code: "STUDIO_PUBLICATION_INTEGRITY" });
    await hub.register(input);
    await hub.register(input);
    assert.equal((await choices("2027-03-28")).items.size, 0);
    await assert.rejects(hub.activate(command, authorise, validateCatalogue), { code: "STUDIO_PUBLICATION_SAFETY_CHANGED" });
    const [firstFence] = await seedSafety(db, first.payload);
    await assert.rejects(hub.activate({ ...command, action: "activate-collection" }, authorise, validateCatalogue), { code: "STUDIO_ACTIVATION_KIND" });
    const activation = await hub.activate(command, authorise, validateCatalogue);
    assert.deepEqual(await hub.activate(command, authorise, validateCatalogue), activation);
    await assert.rejects(hub.activate({ ...command, reason: "Changed request" }, authorise, validateCatalogue),
      { code: "STUDIO_ACTIVATION_COMMAND_CONFLICT" });
    assert.equal((await choices("2027-03-21")).items.size, 0);
    assert.equal((await choices("2027-03-28", "oploc:other")).items.size, 0);
    assert.equal((await choices("2027-03-28")).items.get(item)?.dishes[0].dish.id, first.payload.dishes[0].dish.id);
    assert.equal((await choices("2027-03-29")).items.get(item)?.dishes[0].dish.id, first.payload.dishes[1].dish.id);
    const update = second.create();
    await hub.register(update);
    await seedSafety(db, second.payload);
    await hub.activate({ ...command, publicationId: update.manifest.id, expectedGeneration: 1, commandId: randomUUID() }, authorise, validateCatalogue);
    assert.equal((await choices("2027-04-04")).items.get(item)?.publication.revision, 1);
    assert.equal((await choices("2027-04-05")).items.get(item)?.publication.revision, 2);
    await firstFence.update({ status: "revoked" });
    await assert.rejects(choices("2027-03-28"), { code: "STUDIO_PUBLICATION_SAFETY_CHANGED" });
    assert.equal((await choices("2027-04-05")).items.get(item)?.publication.revision, 2);
  } finally { await deleteApp(app); }
});

test("emulator: a staff-only collection uses separate activation without exposing choices", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const id = randomUUID();
  const hub = new HubStudioPublications(db, "demo-fika-os");
  const item = `hospitality-menu-item:${id}`;
  const collection = publication(id, item, 1, "collection");
  const input = collection.create();
  const command: ActivationCommand = { publicationId: input.manifest.id, oplocId: `oploc:${id}`, expectedGeneration: 0,
    commandId: randomUUID(), confirmed: true, action: "activate-collection", visibility: "staff", reason: "Fictional staff-only collection" };
  try {
    await hub.register(input);
    await seedSafety(db, collection.payload);
    await hub.activate(command, async (_, action) => {
      assert.equal(action.action, "activate-collection");
      return "separate-collection-activator";
    }, async () => {});
    const current = await db.runTransaction(tx => hub.choices(tx, command.oplocId, "2027-03-23", [item]), { readOnly: true });
    assert.equal(current.items.size, 0);
    assert.equal(current.managedItems.has(item), true);
  } finally { await deleteApp(app); }
});
