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
import { bindStudioQuote, prepareStudioBooking } from "../../lib/hospitality-studio-booking";
import { createProductionFromApprovedBookingTransaction } from "../../lib/production-domain";
import { calculateQuoteSnapshot, defaultDashboardQuoteSettings } from "../../lib/quote-engine";
import { RCOA_BOOKING_INGESTION_CONTRACT_VERSION, type CanonicalBooking } from "../../lib/hospitality-booking-service";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { studioDishChoiceId } from "../../../shared/hospitality-menu-studio-selection";
import type { QuoteRevision } from "../../lib/booking-workflow";

const enabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const now = "2026-11-20T12:00:00.000Z";

function publication(menuId: string, itemId: string, revision = 1, kind: "seasonal" | "collection" = "seasonal", fullRotation = false) {
  const dishes = Array.from({ length: fullRotation ? 36 : 2 }, (_, index) => {
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
        mode: "rotation", staticDishIds: [], weeks: fullRotation
          ? Array.from({ length: 6 }, (_, week) => dishes.slice(week * 6, week * 6 + 6).map(item => item.dish.id))
          : [0, 1, 0, 1, 0, 1].map(index => [dishes[index].dish.id]) }] },
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
  const first = publication(id, item, 1, "seasonal", true);
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
    const outsidePilot = await db.runTransaction(tx => hub.choices(tx, site, "2027-03-28", [item], "other-menu"), { readOnly: true });
    assert.equal(outsidePilot.items.size, 0);
    assert.equal(outsidePilot.managedItems.size, 0);
    assert.equal((await choices("2027-03-28")).items.get(item)?.dishes[0].dish.id, first.payload.dishes[0].dish.id);
    const mondays = ["2027-03-22", "2027-03-29", "2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26"];
    for (const [week, monday] of mondays.entries()) {
      const current = (await choices(monday)).items.get(item);
      assert.deepEqual(current?.dishes.map(({ dish }) => dish.id), first.payload.menu.sections[0].weeks[week]);
    }
    assert.deepEqual((await choices("2027-05-03")).items.get(item)?.dishes.map(({ dish }) => dish.id), first.payload.menu.sections[0].weeks[0]);
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
    assert.equal(current.managedItems.has(item), false, "staff activation preserves the ordinary customer item");
  } finally { await deleteApp(app); }
});

test("emulator: Hub freezes accepted Studio selections across a new publication and canonical CPU handoff replay", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const id = randomUUID();
  const hub = new HubStudioPublications(db, "demo-fika-os");
  const canonicalId = `booking:studio:${id}`;
  const ref = db.collection("fikaBookings").doc(canonicalId);
  const oplocId = `oploc:${id}`;
  const itemId = `hospitality-menu-item:rcoa:${id}`;
  const menu = publication(id, itemId, 1, "seasonal", true);
  const selected = menu.payload.dishes.slice(12, 14);
  selected[1].dish.assortment = null;
  selected[1].safety.subject = studioDishReviewSubject(selected[1].dish);
  const first = menu.create();
  const actor = { uid: "synthetic-actor", name: "Synthetic actor", role: "integration-admin", synthetic: true } as const;
  const client = { name: "Fictional customer", companyName: "Fictional company", email: "customer@example.test" };
  const service = { eventDate: "2027-04-05", startTime: "12:00", guestCount: 20, portalSiteId: "rcoa", oplocId };
  const marker = { id: studioDishChoiceId, publicationHash: first.manifest.contentHash, quantities: Object.fromEntries(selected.map(({ dish }) => [dish.id, 4])) };
  const order: CanonicalBooking["order"] = { currency: "GBP", netTotal: 80, vatTotal: 0, grossTotal: 80, items: [{ itemId, itemName: "Finger Food", quantity: 8,
    servingInfo: "pieces", unitPrice: 10, lineTotal: 80, choices: [marker] }] };
  const booking: CanonicalBooking = {
    canonicalId, entityType: "Booking", schemaVersion: "0.1.0", version: 1, commercialVersion: 1, lifecycleStatus: "Quoted",
    createdAt: now, updatedAt: now, createdBy: actor.uid, updatedBy: actor.uid,
    source: { provider: "rcoa-booking-platform", sourceBookingId: "STUDIO-UAT-" + id.toUpperCase(), submissionTimestamp: now,
      contractVersion: RCOA_BOOKING_INGESTION_CONTRACT_VERSION, originalPayload: { bookingId: id, submittedAt: now, client, event: service, order } },
    client, service, order: structuredClone(order), deliveryChargeRequired: true, dietaries: {}, acknowledgements: {}, attachments: [],
    statusHistory: [], audit: [],
  };
  const activate = (manifestId: string, expectedGeneration: number) => hub.activate({
    publicationId: manifestId, oplocId, expectedGeneration, commandId: randomUUID(),
    confirmed: true, action: "activate-seasonal", visibility: "customer", reason: "Fictional review fixture",
  }, async () => actor.uid, async () => {});
  const accept = (candidate: CanonicalBooking) => db.runTransaction(async transaction => {
    const stage = await prepareStudioBooking(transaction, ref, candidate, { allowed: true,
      publications: hub, offerings: () => [{ itemId, offeringMode: "standard", price: { amount: 10, vatRate: 0.05 },
        configuration: { choices: [{ id: "variety", controlType: "quantities", minimumQuantity: 3 }] } }],
    });
    stage();
    transaction.create(ref, candidate);
  });
  try {
    await hub.register(first);
    await seedSafety(db, menu.payload);
    await activate(first.manifest.id, 0);
    const forged = structuredClone(booking);
    forged.order.items[0].choices = [{ ...marker, publicationHash: "f".repeat(64) }];
    await assert.rejects(accept(forged), { code: "STUDIO_BOOKING_SELECTION_CHANGED" });
    assert.equal((await ref.get()).exists, false);
    const tooFew = structuredClone(booking);
    tooFew.order.items[0].quantity = 2;
    tooFew.order.items[0].choices = [{ ...marker, quantities: { [selected[0].dish.id]: 2 } }];
    await assert.rejects(accept(tooFew), { code: "STUDIO_DISH_MINIMUM" });
    const duplicatePicker = structuredClone(booking);
    duplicatePicker.order.items[0].choices = [marker, { id: "variety", quantities: { previous: 4 } }];
    await assert.rejects(accept(duplicatePicker), { code: "STUDIO_BOOKING_SELECTION_CHANGED" });
    await accept(booking);
    assert.equal(booking.studioKitchenEvidenceVersion, 1);
    assert.equal(booking.order.items[0].acceptedCatalogueVatRate, 0.05);
    assert.deepEqual((booking.order.items[0].choices?.[0] as { customerDescriptions?: unknown }).customerDescriptions,
      Object.fromEntries(selected.map(({ dish }) => [dish.id, "Customer copy"])));
    assert.doesNotMatch(JSON.stringify((await ref.get()).data()), /Private kitchen instructions/);
    const update = publication(id, itemId, 2, "seasonal", true);
    const changed = update.payload.dishes[12];
    changed.dish.kitchenDescription = "Later kitchen instructions";
    changed.safety.subject = studioDishReviewSubject(changed.dish);
    const second = update.create();
    await hub.register(second);
    await seedSafety(db, update.payload);
    await activate(second.manifest.id, 1);
    const quote: QuoteRevision = { id: `quote:${canonicalId}:r1`, revision: 1, createdAt: now, createdBy: actor.uid,
      commercialVersion: 1, stale: false, pdfStatus: "saved", driveFileId: "fictional-pdf", documentReference: "fixture-quote",
      snapshot: calculateQuoteSnapshot(booking, defaultDashboardQuoteSettings("rcoa")) };
    const priced = calculateQuoteSnapshot(booking, defaultDashboardQuoteSettings("rcoa"));
    assert.equal(priced.order.lines[0].acceptedCatalogueVatRate, 0.05);
    assert.equal(priced.totals.vat.amount, 11);
    await db.runTransaction(async transaction => {
      await bindStudioQuote(transaction, ref, booking, quote);
      transaction.update(ref, { quoteState: { currentRevisionId: quote.id, revisions: [quote] } });
    });
    await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(itemId)).create({ menuItemId: itemId, workstreams: ["hospitality"] });
    const created = await createProductionFromApprovedBookingTransaction(actor, canonicalId, `synthetic:${id}`);
    assert.equal(created.status, "created");
    assert.equal((await ref.get()).get("lifecycleStatus"), "Sent to CPU");
    assert.equal(created.order?.studioRehearsal, true);
    const spec = created.order?.lines[0].studioKitchenSpec?.selections[0];
    assert.equal(spec?.kitchenDescription, "Private kitchen instructions");
    assert.equal(spec?.publication.publicationId, first.manifest.id);
    assert.equal(spec?.assortment?.boxCount, 4);
    assert.equal(spec?.assortment?.expectedTotal, 24);
    const plain = created.order?.lines[0].studioKitchenSpec?.selections[1];
    assert.equal(plain?.selectionId, selected[1].dish.id);
    assert.equal(plain?.customerQuantity, 4);
    assert.equal(plain?.assortment, null);
    const retry = await createProductionFromApprovedBookingTransaction(actor, canonicalId, `synthetic:${id}`);
    assert.equal(retry.status, "already_exists");
    assert.deepEqual(retry.order?.lines, created.order?.lines);
    const requirements = await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", created.order?.canonicalId).get();
    assert.equal(requirements.size, 1);
    assert.equal(requirements.docs[0].get("studioRehearsal"), true);
    assert.equal((await db.collection("fikaLogisticsProjectionOutboxV1").where("sourceAggregateId", "==", requirements.docs[0].get("canonicalId")).get()).size, 0);
    assert.equal((await db.collection("fikaBookingNotifications").where("bookingId", "==", canonicalId).get()).size, 0);
  } finally { await deleteApp(app); }
});
