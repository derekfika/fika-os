import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { bookingWorkspace, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { createProductionFromApprovedBooking, productionOrderV1Id } from "../lib/production-domain";
import { explicitMenuProductionRouting } from "../lib/connections-service";
import { classifyHospitalityLine, routingKeys } from "../lib/hospitality-cpu-routing";
import { planServiceProduction, sendPendingServices } from "../../hospitality-booking/lib/cpu-production-plan";
import { groupRequestedItems } from "../../hospitality-booking/lib/booking-presentation";
import type { CanonicalBooking as ClientBooking, ProductionOrder as ClientOrder } from "../../hospitality-booking/lib/canonical-types";
const londonBusinessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// This suite can only write into a deliberately enabled loopback demo emulator, never an operational store.
const enabled = process.env.FIKA_UAT_INTEGRATION_EMULATOR_TEST === "true";
test("Hub canonical routing -> grouped chronological Hospitality -> independent child orders and partial retries", { skip: !enabled }, async () => {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8905");
  const key = randomUUID(); const now = new Date().toISOString();
  const groupId = `group:${key}`; const oplocId = `oploc:${key}`;
  const current = `hospitality-menu-item:canonical:${key}`;
  const historical = `hospitality-menu-item:rcoa:old-${key}`;
  const sandwich = `hospitality-menu-item:canonical:sand-${key}`;
  const delivered = `hospitality-menu-item:canonical:di-${key}`;
  const inHouse = `hospitality-menu-item:canonical:tea-${key}`;
  const unresolved = `hospitality-menu-item:canonical:unknown-${key}`;
  const conflicting = `hospitality-menu-item:canonical:conflict-${key}`;
  const routing = db.collection("integrationHubHospitalityMenuProductionRouting");
  const merges = db.collection("integrationHubHospitalityMenuItemMerges");
  const orders = db.collection("fikaProductionOrdersV1");
  const actor = { uid: "test:uat-integration", role: "integration-admin" as const, name: "UAT fixture", synthetic: true as const };
  const make = (sequence: number, time: string, menuItemId: string): CanonicalBooking => {
    const id = `booking:rcoa:${key}:${sequence}`; const quoteId = `${id}:quote:1`;
    return { canonicalId: id, entityType: "Booking", schemaVersion: "0.1.0", version: 1, lifecycleStatus: "Quoted", commercialVersion: 1,
      createdAt: now, updatedAt: now, createdBy: actor.uid, updatedBy: actor.uid,
      source: { provider: "rcoa-booking-platform", sourceBookingId: id, submissionTimestamp: now, originalPayload: {} },
      bookingGroup: { id: groupId, sequence, size: 4 },
      client: { name: "UAT", companyName: "Isolated test", email: "uat@example.test" },
      service: { portalSiteId: "rcoa", portalSiteLabel: "RCoA", oplocId, eventDate: londonBusinessDate(), startTime: time, guestCount: 10, roomOrArea: "Test room" },
      order: { eventType: "lunch", items: [{ itemId: `source-${sequence}`, menuItemId, itemName: `Item ${sequence}`, unitPrice: 2, quantity: 10, lineTotal: 20 }], netTotal: 20, currency: "GBP", vatTotal: 4, grossTotal: 24 },
      quoteState: { currentRevisionId: quoteId, revisions: [{ id: quoteId, revision: 1, createdAt: now, createdBy: actor.uid, commercialVersion: 1, stale: false, pdfStatus: "saved", driveFileId: "test-only-file", documentReference: "test-only", snapshot: {} }] },
      deliveryChargeRequired: true, dietaries: {}, acknowledgements: {}, attachments: [], statusHistory: [], audit: [],
    } as unknown as CanonicalBooking;
  };
  const children = [make(1, "09:00", historical), make(2, "11:00", inHouse), make(3, "13:00", sandwich), make(4, "15:00", delivered)];
  const refs: FirebaseFirestore.DocumentReference[] = [];
  const put = async (ref: FirebaseFirestore.DocumentReference, value: object) => { refs.push(ref); await ref.set(value); };
  try {
    for (const [id, workstreams] of [[current, ["hospitality"]], [sandwich, ["sandwiches"]], [delivered, ["delivered_in"]], [inHouse, []], [conflicting, ["sandwiches", "hospitality"]]] as Array<[string, string[]]>) {
      await put(routing.doc(stableDocumentId(id)), { menuItemId: id, workstreams });
    }
    await put(routing.doc(stableDocumentId(historical)), { menuItemId: historical, workstreams: ["sandwiches"], supersededBy: current });
    await put(merges.doc(stableDocumentId(historical)), { sourceMenuItemId: historical, survivorMenuItemId: current });
    await put(db.collection("integrationHubSourceMappings").doc(`uat-${key}`), { sourceIdentifier: "rcoa", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId });
    for (const child of children) await put(db.collection("fikaBookings").doc(child.canonicalId), child);
    const decisions = await explicitMenuProductionRouting([historical, current, unresolved, conflicting]);
    assert.deepEqual(decisions[historical], ["hospitality"]);
    assert.deepEqual(routingKeys({ itemId: "old-provider-key", menuItemId: current }, "rcoa"), [current], "canonical reference never guesses a site copy");
    assert.equal(classifyHospitalityLine({ itemId: unresolved }, "rcoa", decisions).state, "routing_required");
    assert.equal(classifyHospitalityLine({ itemId: conflicting }, "rcoa", decisions).state, "routing_conflict");

    const workspace = () => bookingWorkspace("rcoa", oplocId);
    const first = await workspace();
    const group = first.bookingGroups.find(group => group.id === groupId)!;
    assert.ok(group); assert.equal(first.dashboardBookings.filter(booking => children.some(child => child.canonicalId === booking.canonicalId)).length, 0);
    assert.deepEqual(groupRequestedItems(group).map(row => row.time), ["09:00", "11:00", "13:00", "15:00"]);
    assert.deepEqual(children.map(child => first.cpuRouting![child.canonicalId].lines[0].state), ["cpu_hospitality", "in_house", "cpu_sandwiches", "cpu_delivered_in"]);
    const rows = (view: Awaited<ReturnType<typeof workspace>>) => children.map(child => {
      const stored = view.bookings.find(booking => booking.canonicalId === child.canonicalId)!;
      const client: ClientBooking = { ...stored, cpuRouting: view.cpuRouting![child.canonicalId] } as unknown as ClientBooking;
      return planServiceProduction(client, view.productionOrders[child.canonicalId] as ClientOrder | undefined, child.service.startTime);
    });
    const calls: string[] = []; let failSandwich = true;
    const send = async (id: string) => {
      calls.push(id);
      if (id === children[2].canonicalId && failSandwich) throw new Error("Isolated simulated transient failure");
      const result = await createProductionFromApprovedBooking(actor, id, `group-uat:${id}`);
      assert.ok(result.order); return { status: "sent" as const };
    };
    const partial = await sendPendingServices(rows(first), send);
    assert.equal(partial[children[2].canonicalId].status, "failed");
    assert.equal(partial[children[3].canonicalId].status, "sent", "failure does not stop later eligible children");
    failSandwich = false;
    const retry = await sendPendingServices(rows(await workspace()), send);
    assert.deepEqual(Object.keys(retry), [children[2].canonicalId]);
    assert.deepEqual(await sendPendingServices(rows(await workspace()), send), {});
    assert.equal(calls.filter(id => id === children[0].canonicalId).length, 1);
    assert.equal(calls.includes(children[1].canonicalId), false, "explicit No CPU creates no order");
    const actual = await orders.where("destinationOplocId", "==", oplocId).get();
    assert.equal(actual.size, 3); assert.equal(new Set(actual.docs.map(doc => doc.id)).size, 3);
    assert.deepEqual(actual.docs.map(doc => doc.data().lines[0].workstream).sort(), ["delivered_in", "hospitality", "sandwiches"]);
    assert.ok(actual.docs.some(doc => doc.data().lines[0].sourceMenuItemId === historical), "historical lineage remains traceable");
    const missing = make(5, "16:00", unresolved); delete missing.bookingGroup;
    await put(db.collection("fikaBookings").doc(missing.canonicalId), missing);
    await assert.rejects(createProductionFromApprovedBooking(actor, missing.canonicalId, "missing-route"), /Routing required/);
    assert.equal((await orders.doc(stableDocumentId(productionOrderV1Id(missing.canonicalId))).get()).exists, false);
  } finally {
    // The demo emulator is disposable and is not exported. Remove owned test roots too for repeatability.
    const batch = db.batch(); for (const ref of refs) batch.delete(ref); await batch.commit();
  }
});
