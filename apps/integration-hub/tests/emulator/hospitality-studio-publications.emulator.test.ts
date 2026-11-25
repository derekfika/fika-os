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
import {
  decodeStudioProductPublication, studioProductChoicesForDate, studioProductMenuId, studioProductPublicationContract, type StudioProductPublication,
} from "../../../shared/hospitality-menu-studio-product-publication";
import { HubStudioPublications, type ActivationCommand } from "../../lib/hospitality-studio-publications";
import { bindStudioQuote, prepareStudioBooking } from "../../lib/hospitality-studio-booking";
import { acceptedStudioKitchenEvidenceRef } from "../../lib/hospitality-studio-kitchen-handoff";
import { createProductionFromApprovedBookingTransaction, productionOrderV1Id } from "../../lib/production-domain";
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

function productPublication(legacy: PublicationPackage, presentation: "dropdown" | "checkboxes" | "quantities" = "quantities") {
  const section = legacy.menu.sections[0];
  const itemId = section.catalogueItemId;
  const menuId = studioProductMenuId(itemId);
  const revision = legacy.publicationRevision;
  const dishesById = new Map(legacy.dishes.map(record => [record.dish.id, record.dish]));
  const payload: StudioProductPublication = {
    contract: studioProductPublicationContract, projectId: legacy.projectId, sourceApp: legacy.sourceApp,
    itemId, itemName: legacy.menu.name, publicationId: publicationIdFor(menuId, revision), publicationRevision: revision,
    sourceDraftVersion: legacy.sourceDraftVersion, previousPublicationId: revision === 1 ? null : publicationIdFor(menuId, revision - 1),
    effectiveDate: legacy.effectiveDate, catalogueHash: legacy.catalogueHash, dishes: legacy.dishes,
    configuration: { presentation, groups: [], schedule: { kind: "rotation", anchorMonday: legacy.menu.anchorMonday,
      weeks: section.weeks.map(ids => ({ groups: [], dishes: ids.map(dishId => ({ dishId, revision: dishesById.get(dishId)!.version })) })),
    } },
  };
  const body = canonicalJson(payload);
  return { body, manifest: { id: payload.publicationId, menuId, menuName: payload.itemName, revision, effectiveDate: payload.effectiveDate,
    publishedAt: now, publishedBy: "synthetic-publisher", scope: {}, sourceDraftVersion: payload.sourceDraftVersion, contentHash: publicationHash(body) } };
}

async function seedSafety(db: ReturnType<typeof getFirestore>, payload: Pick<PublicationPackage, "dishes">) {
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

test("emulator: Hub registers exact product packages only with current CPU evidence and does not activate them", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const hub = new HubStudioPublications(db, "demo-fika-os");
  const id = randomUUID();
  const itemId = `hospitality-menu-item:${id}`;
  const menuId = studioProductMenuId(itemId);
  const site = `oploc:${id}`;
  const dishes = publication(id, itemId).payload.dishes;
  dishes[1].dish = { ...dishes[1].dish, id: dishes[0].dish.id, version: 2 };
  dishes[1].safety.subject = studioDishReviewSubject(dishes[1].dish);
  dishes[1].safety.releaseId = `cpu-studio-dish-release:${studioDishReviewKey(dishes[1].dish.id, 2)}:v1`;
  const data: StudioProductPublication = {
    contract: studioProductPublicationContract, previousPublicationId: null, projectId: "demo-fika-os",
    sourceApp: "hospitality-menu-studio", publicationId: publicationIdFor(menuId, 1), publicationRevision: 1,
    sourceDraftVersion: 3, itemId, itemName: "Finger Food fixture", catalogueHash: "a".repeat(64),
    effectiveDate: "2027-03-22", dishes, configuration: { presentation: "checkboxes",
      groups: [{ id: "group-one", name: "Group One", presentation: "dropdown" }],
      schedule: { kind: "rotation", anchorMonday: "2027-03-22", weeks: [0, 1, 0].map(index => ({
        groups: [{ groupId: "group-one", dishes: [{ dishId: dishes[index].dish.id, revision: dishes[index].dish.version }] }], dishes: [],
      })) },
    },
  };
  const body = canonicalJson(data);
  const manifest = { id: data.publicationId, menuId, menuName: data.itemName, revision: 1, effectiveDate: data.effectiveDate,
    publishedAt: now, publishedBy: "fixture-publisher", scope: {}, sourceDraftVersion: data.sourceDraftVersion, contentHash: publicationHash(body) };
  try {
    const verified = decodeStudioProductPublication(body, manifest, "demo-fika-os");
    assert.ok(verified);
    assert.equal(studioProductChoicesForDate(verified, "2027-03-21"), undefined);
    assert.deepEqual(["2027-03-22", "2027-03-29", "2027-04-05", "2027-04-12"].map(date => {
      const choices = studioProductChoicesForDate(verified, date);
      return [choices?.week, choices?.groups[0].presentation, choices?.groups[0].dishes[0].dish.version];
    }), [[1, "dropdown", 1], [2, "dropdown", 2], [3, "dropdown", 1], [1, "dropdown", 1]]);
    await assert.rejects(hub.register({ manifest, body }), { code: "STUDIO_PUBLICATION_SAFETY_CHANGED" });
    const [firstFence] = await seedSafety(db, data);
    const wrongBytes = canonicalJson({ ...data, dishes: [...data.dishes].reverse() });
    await assert.rejects(hub.register({ manifest: { ...manifest, contentHash: publicationHash(wrongBytes) }, body: wrongBytes }),
      { code: "STUDIO_PUBLICATION_INTEGRITY" });
    const receipt = await hub.register({ manifest, body });
    assert.deepEqual(receipt, { publicationId: manifest.id, contentHash: manifest.contentHash });
    await assert.rejects(hub.register(publication(menuId, itemId).create()), { code: "STUDIO_PUBLICATION_INTEGRITY" });
    assert.equal(await hub.generation(site), 0);
    const choices = await db.runTransaction(tx => hub.choices(tx, site, data.effectiveDate, [itemId]), { readOnly: true });
    assert.equal(choices.items.size, 0);
    await assert.rejects(hub.activate({
      action: "activate-product", confirmed: true, commandId: randomUUID(), expectedGeneration: 0,
      publicationId: receipt.publicationId, oplocId: site, visibility: "customer", reason: "Isolated fixture",
    }, async () => "fixture-activator", async () => {}, { firstDate: "2027-03-22", lastDate: "2027-05-17" }),
    { code: "STUDIO_CHOICE_QUANTITY_POLICY_UNAVAILABLE" });
    await firstFence.update({ status: "revoked" });
    assert.deepEqual(await hub.register({ manifest, body }), receipt, "replaying an immutable delivery does not change safety or activation");
  } finally { await deleteApp(app); }
});

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

for (const presentation of [undefined, "quantities", "dropdown"] as const) test(`emulator: Hub freezes accepted ${presentation ?? "legacy"} Studio selections across publication and canonical CPU handoff replay`, { skip: !enabled }, async () => {
  const product = presentation !== undefined;
  const app = initializeApp({ projectId: "demo-fika-os" }, randomUUID());
  const db = getFirestore(app);
  const id = randomUUID();
  const hub = new HubStudioPublications(db, "demo-fika-os");
  const canonicalId = `booking:studio:${id}`;
  const ref = db.collection("fikaBookings").doc(canonicalId);
  const oplocId = `oploc:${id}`;
  const itemId = `hospitality-menu-item:rcoa:${id}`;
  const menu = publication(id, itemId, 1, "seasonal", true);
  const selected = menu.payload.dishes.slice(12, presentation === "dropdown" ? 13 : 14);
  if (selected[1]) {
    selected[1].dish.assortment = null;
    selected[1].safety.subject = studioDishReviewSubject(selected[1].dish);
  }
  const perDish = 8 / selected.length;
  const first = product ? productPublication(menu.payload, presentation) : menu.create();
  const actor = { uid: "synthetic-actor", name: "Synthetic actor", role: "integration-admin", synthetic: true } as const;
  const client = { name: "Fictional customer", companyName: "Fictional company", email: "customer@example.test" };
  const service = { eventDate: "2027-04-05", startTime: "12:00", guestCount: 20, portalSiteId: "rcoa", oplocId };
  const marker = { id: studioDishChoiceId, publicationHash: first.manifest.contentHash,
    quantities: Object.fromEntries(selected.map(({ dish }) => [dish.id, perDish])), ...(product ? { studioPresentation: presentation } : {}) };
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
    confirmed: true, action: product ? "activate-product" : "activate-seasonal", visibility: "customer", reason: "Fictional review fixture",
  }, async () => actor.uid, async () => {}, product ? { firstDate: "2027-03-22", lastDate: "2027-05-17" } : undefined);
  const accept = (candidate: CanonicalBooking) => db.runTransaction(async transaction => {
    const stage = await prepareStudioBooking(transaction, ref, candidate, { allowed: true,
      publications: hub, offerings: () => [{ itemId, offeringMode: "standard", price: { amount: 10, vatRate: 0.05 },
        configuration: { rules: { salesUnit: "piece" }, choices: [{ id: "variety", controlType: "quantities", minimumQuantity: 3 }] } }],
    });
    stage();
    transaction.create(ref, candidate);
  });
  try {
    await seedSafety(db, menu.payload);
    await hub.register(first);
    await activate(first.manifest.id, 0);
    const resolved = await db.runTransaction(tx => hub.choices(tx, oplocId, service.eventDate, [itemId]), { readOnly: true });
    assert.deepEqual(resolved.items.get(itemId)?.dishes.map(record => record.dish.id), menu.payload.menu.sections[0].weeks[2]);
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
    if (product) {
      const staleUi = structuredClone(booking);
      staleUi.order.items[0].choices = [{ ...marker, studioPresentation: presentation === "dropdown" ? "quantities" : "dropdown" }];
      await assert.rejects(accept(staleUi), { code: "STUDIO_BOOKING_SELECTION_CHANGED" });
    }
    if (presentation === "dropdown") {
      const wrongCount = structuredClone(booking);
      wrongCount.order.items[0].choices = [{ ...marker, quantities: { [selected[0].dish.id]: 4, [menu.payload.dishes[13].dish.id]: 4 } }];
      await assert.rejects(accept(wrongCount), { code: "STUDIO_BOOKING_SELECTION_CHANGED" });
    }
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
    const second = product ? productPublication(update.payload, presentation) : update.create();
    await seedSafety(db, update.payload);
    await hub.register(second);
    await activate(second.manifest.id, 1);
    const quote: QuoteRevision = { id: `quote:${canonicalId}:r1`, revision: 1, createdAt: now, createdBy: actor.uid,
      commercialVersion: 1, stale: false, pdfStatus: "saved", driveFileId: "fictional-pdf", documentReference: "fixture-quote",
      snapshot: calculateQuoteSnapshot(booking, defaultDashboardQuoteSettings("rcoa")) };
    const priced = calculateQuoteSnapshot(booking, defaultDashboardQuoteSettings("rcoa"));
    assert.equal(priced.order.lines[0].acceptedCatalogueVatRate, 0.05);
    assert.equal(priced.totals.vat.amount, 11);
    const accepted = ref.collection("private").doc("studio-accepted-menu-v1");
    const originalLines = (await accepted.get()).get("lines");
    const wrongQuantities = structuredClone(originalLines);
    wrongQuantities[0].spec.selections[0].customerQuantity = 3;
    wrongQuantities[0].spec.selections[0].assortment.boxCount = 3;
    if (selected[1]) wrongQuantities[0].spec.selections[1].customerQuantity = 5;
    const quoteEvidence = acceptedStudioKitchenEvidenceRef(ref, quote.id);
    const unversioned = structuredClone(booking);
    delete unversioned.studioKitchenEvidenceVersion;
    await assert.rejects(db.runTransaction(tx => bindStudioQuote(tx, ref, unversioned, quote)), { code: "STUDIO_KITCHEN_SPEC_INTEGRITY_FAILURE" });
    assert.equal((await quoteEvidence.get()).exists, false);
    await accepted.update({ lines: wrongQuantities });
    await assert.rejects(db.runTransaction(tx => bindStudioQuote(tx, ref, booking, quote)), { code: "STUDIO_KITCHEN_SPEC_INTEGRITY_FAILURE" });
    assert.equal((await quoteEvidence.get()).exists, false);
    await accepted.update({ lines: originalLines });
    const missingLine = structuredClone(booking);
    missingLine.order.items.push(structuredClone(booking.order.items[0]));
    await assert.rejects(db.runTransaction(tx => bindStudioQuote(tx, ref, missingLine, quote)), { code: "STUDIO_KITCHEN_SPEC_INTEGRITY_FAILURE" });
    assert.equal((await quoteEvidence.get()).exists, false);
    await db.runTransaction(async transaction => {
      await bindStudioQuote(transaction, ref, booking, quote);
      transaction.update(ref, { quoteState: { currentRevisionId: quote.id, revisions: [quote] } });
    });
    await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(itemId)).create({ menuItemId: itemId, workstreams: ["hospitality"] });
    const bound = (await quoteEvidence.get()).get("lines");
    await quoteEvidence.update({ lines: [{ ...bound[0], spec: wrongQuantities[0].spec }] });
    await assert.rejects(createProductionFromApprovedBookingTransaction(actor, canonicalId, `synthetic:${id}`), { code: "STUDIO_KITCHEN_SPEC_INTEGRITY_FAILURE" });
    assert.equal((await ref.get()).get("lifecycleStatus"), "Quoted");
    assert.equal((await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(productionOrderV1Id(canonicalId))).get()).exists, false);
    await quoteEvidence.update({ lines: bound });
    const created = await createProductionFromApprovedBookingTransaction(actor, canonicalId, `synthetic:${id}`);
    assert.equal(created.status, "created");
    assert.equal((await ref.get()).get("lifecycleStatus"), "Sent to CPU");
    assert.equal(created.order?.studioRehearsal, true);
    assert.equal(created.order?.lines[0].customerUnit, "piece");
    const spec = created.order?.lines[0].studioKitchenSpec?.selections[0];
    assert.equal(spec?.kitchenDescription, "Private kitchen instructions");
    assert.equal(spec?.publication.publicationId, first.manifest.id);
    assert.equal(spec?.assortment?.boxCount, perDish);
    assert.equal(spec?.assortment?.expectedTotal, 24);
    const plain = created.order?.lines[0].studioKitchenSpec?.selections[1];
    if (selected[1]) {
      assert.equal(plain?.selectionId, selected[1].dish.id);
      assert.equal(plain?.customerQuantity, perDish);
      assert.equal(plain?.assortment, null);
    } else assert.equal(plain, undefined);
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
