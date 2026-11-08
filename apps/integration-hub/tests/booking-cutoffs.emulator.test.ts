import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST as existingPost } from "../app/api/bookings/mnk/existing/route";
import { POST } from "../app/api/bookings/mnk/route";
import { POST as dashboardPost } from "../app/api/hospitality-bookings/route";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { assertHospitalityBookingDate } from "../lib/hospitality-booking-cutoffs";
import { executeBookingWorkflow, canonicalBookingId, amendHospitalityBookingGroup, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { groupCommercialState } from "../lib/hospitality-group-commercial";
import type { Actor } from "../lib/auth";
import { FirestoreAuthModRepository } from "../lib/authmod-core/firestore-repository";
import { HOSPITALITY_BOOKING_ADMIN, V1_APPLICATIONS } from "../lib/authmod-core/model";
import { grantAuthority, revokeAuthority } from "../lib/authmod-core/authority";
import { setFullAccess } from "../lib/authmod-core/identity";
import { grantStandardApplicationAccess } from "../lib/authmod-core";
import { groupAmendmentCommand } from "../lib/hospitality-group-amendment";
import { requireHospitalityBookingAdmin } from "../lib/hospitality-booking-authorization";
import { rebuildOplocReadPackage } from "../lib/oploc-read-package";
import { addBusinessDate, ukBookingClock, deliveryWeekday, earliestSandwichDelivery } from "@fika/server-shared/hospitality-effective-offering";
const enabled = process.env.FIKA_CUTOFF_EMULATOR_TEST === "true" && process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292";
const actor: Actor = { uid: "test:cutoff", name: "Cutoff test", role: "integration-admin", synthetic: true };
async function snapshot() {
  const rows = [];
  for (const collection of await db.listCollections()) for (const doc of (await collection.get()).docs) rows.push([doc.ref.path, doc.data()]);
  return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
test("emulator: real Hub POST rejects prohibited dates before any persistence; current routing, sparse notices, retries and amendments", { skip: !enabled }, async t => {
  const reset = await fetch("http://127.0.0.1:8292/emulator/v1/projects/demo-fika-os/databases/(default)/documents", { method: "DELETE" });
  assert.ok(reset.ok);
  const tag = randomUUID(), site = `oploc:cutoff:${tag}`, sandwich = `hospitality-menu-item:opaque:${tag}`, rolls = `hospitality-menu-item:${tag}:rice_paper_rolls`, standard = `hospitality-menu-item:${tag}:coffee`;
  process.env.MNK_CANON_BRIDGE_TOKEN = "isolated-cutoff-test";
  const canonical = db.collection("integrationHubCanonical");
  const put = (id: string, entityType: string, record: object) => canonical.doc(stableDocumentId(id)).set({ canonicalId: id, entityType, lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active", ...record } });
  await put(site, "OPLOC", { approvedName: "Test site" });
  for (const id of [sandwich, rolls, standard]) {
    await put(id, "Hospitality Menu Item", { name: "Test product", category: "Lunch", defaultMinimumQuantity: 1, ...(id === sandwich ? { configuration: { rules: { noticeHours: 72 } } } : {}), providerMappings: [{ provider: "angel-court-hospitality-brochure", sourceItemId: id }] });
    await put(id + ":price", "Hospitality Menu Price", { hospitalityMenuItemId: id, amount: 1, vatRate: 0, effectiveFrom: "2020-01-01" });
  }
  await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(sandwich)).set({ menuItemId: sandwich, workstreams: ["sandwiches"] });
  await db.collection("integrationHubSourceMappings").doc("cutoff-" + tag).set({ sourceIdentifier: "angel-court", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: site });
  let future = addBusinessDate(ukBookingClock(new Date().toISOString()).date, 60);
  while ([0, 6].includes(deliveryWeekday(future))) future = addBusinessDate(future);
  const payload = (id: string, date: string, group?: { id: string; sequence: number; size: number }) => ({ bookingId: "CUTOFF-" + randomUUID(), submittedAt: "2099-01-01T00:00:00Z", siteId: "angel-court", site: "Angel Court", ...(group ? { bookingGroup: group } : {}), client: { name: "Test", email: "test@example.test", companyName: "Test" }, event: { eventDate: date, startTime: "09:00", guestCount: 10 }, order: { eventType: "lunch", items: [{ itemId: id, itemName: "Coffee", unitPrice: 1, quantity: 10, lineTotal: 10, noticeRequiredDays: 0 }], netTotal: 10 } });
  const call = (body: unknown) => POST(new NextRequest("http://test/api/bookings/mnk", { method: "POST", headers: { "content-type": "application/json", "x-fika-mnk-bridge-token": "isolated-cutoff-test" }, body: JSON.stringify(body) }));
  const deny = async (body: unknown, code: string) => { const before = await snapshot(); const response = await call(body); assert.equal(response.status, 422); const result = await response.json(); assert.equal(result.error.code, code); assert.deepEqual(await snapshot(), before, "rejection must not write evidence, notifications, outbox, production or logistics"); };
  const tooSoon = addBusinessDate(earliestSandwichDelivery(new Date().toISOString()), -1);
  const shortNoticeCode = [0, 6].includes(deliveryWeekday(tooSoon)) ? "DELIVERY_WEEKEND" : "BOOKING_NOTICE";
  await deny(payload(sandwich, tooSoon), shortNoticeCode);
  await deny(payload(standard, tooSoon), shortNoticeCode);
  const beforeEmpty = await snapshot();
  await assert.rejects(db.runTransaction(transaction => assertHospitalityBookingDate(transaction, { service: { portalSiteId: "angel-court", oplocId: site, eventDate: "2026-10-22", startTime: "09:00" }, order: { items: [], eventType: "lunch" } } as unknown as CanonicalBooking, "2026-10-20T18:30:00+01:00")), (error: any) => error.status === 422 && error.code === "BOOKING_NOTICE" && error.earliestDate === "2026-10-23");
  assert.deepEqual(await snapshot(), beforeEmpty, "empty basket boundary checks do not write anything");
  let friday = future; while (deliveryWeekday(friday) !== 5) friday = addBusinessDate(friday);
  await deny(payload(rolls, friday), "SUMMER_ROLL_FRIDAY");
  await deny(payload(sandwich, addBusinessDate(friday)), "DELIVERY_WEEKEND");
  assert.equal((await call(payload(sandwich, earliestSandwichDelivery(new Date().toISOString())))).status, 200, "opaque routing-classified sandwich supersedes the obsolete 72-hour floor");
  const offering = sandwich + ":site";
  await put(offering, "Hospitality Menu Offering", { hospitalityMenuItemId: sandwich, oplocId: site, offeringMode: "standard", noticeRequiredDays: 10 });
  await deny(payload(sandwich, earliestSandwichDelivery(new Date().toISOString())), "PRODUCT_NOTICE");
  const accepted = payload(sandwich, future), response = await call(accepted);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json(), ref = db.collection("fikaBookings").doc(body.canonicalBookingId);
  const current = (await ref.get()).data() as CanonicalBooking;
  const beforeReplay = await snapshot(); assert.equal((await call(accepted)).status, 200); assert.deepEqual(await snapshot(), beforeReplay, "idempotent replay creates no new work");
  const patch = { client: current.client, service: { eventDate: tooSoon, startTime: "09:00", guestCount: 10 }, order: { items: [{ itemId: sandwich, itemName: "Forged coffee", unitPrice: 1, quantity: 11 }] } };
  const beforeAmend = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, current.canonicalId, current.version, { action: "amend", reason: "Test", patch }), (e: any) => e.status === 422);
  assert.deepEqual(await snapshot(), beforeAmend, "failed amendment cannot stale quotes or update downstream work");
  const standardPayload = payload(standard, future), standardResponse = await call(standardPayload);
  assert.equal(standardResponse.status, 200);
  const standardCurrent = (await db.collection("fikaBookings").doc((await standardResponse.json()).canonicalBookingId).get()).data() as CanonicalBooking;
  const standardPatch = { ...patch, client: standardCurrent.client, order: { items: [{ itemId: standard, itemName: "Coffee", unitPrice: 1, quantity: 10 }] } };
  const beforeStandardAmend = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, { action: "amend", reason: "Standard booking date changed", patch: standardPatch }), (error: any) => error.status === 422 && error.code === shortNoticeCode);
  assert.deepEqual(await snapshot(), beforeStandardAmend, "non-sandwich material amendments enforce the same minimum before writes");
  const groupId = "CUTOFF-GROUP-" + tag;
  const grouped = [];
  for (const sequence of [1, 2]) { const p = payload(standard, future, { id: groupId, sequence, size: 2 }); const r = await call(p); assert.equal(r.status, 200); grouped.push((await db.collection("fikaBookings").doc(canonicalBookingId(p.bookingId, "angel-court")).get()).data() as any); }
  const legacy = { ...current, service: { ...current.service, eventDate: "2026-01-05" } };
  await ref.set(legacy);
  const beforeHistoricalReplay = await snapshot();
  assert.equal((await call({ ...accepted, event: { ...accepted.event, eventDate: legacy.service.eventDate } })).status, 200);
  assert.deepEqual(await snapshot(), beforeHistoricalReplay, "an exact historical retry is grandfathered without any writes");
  const historicalPatch = { client: legacy.client, service: { eventDate: legacy.service.eventDate, startTime: legacy.service.startTime, guestCount: legacy.service.guestCount }, order: { items: legacy.order.items.map((item: any) => ({ itemId: item.itemId, itemName: item.itemName, unitPrice: item.unitPrice, quantity: item.quantity, ...(item.choices ? { choices: item.choices } : {}) })) }, notes: "Historical contact-only amendment" };
  await executeBookingWorkflow(actor, legacy.canonicalId, legacy.version, { action: "amend", reason: "Contact only", patch: historicalPatch });
  const historicalSaved = (await ref.get()).data() as CanonicalBooking;
  for (const serviceChange of [{ guestCount: historicalSaved.service.guestCount + 1 }, { endTime: "10:00" }, { roomOrArea: "Changed destination" }]) {
    const beforeMaterialHistory = await snapshot();
    await assert.rejects(executeBookingWorkflow(actor, legacy.canonicalId, historicalSaved.version, { action: "amend", reason: "Operational service changed", patch: { ...historicalPatch, service: { ...historicalPatch.service, ...serviceChange } } }), (error: any) => error.status === 422);
    assert.deepEqual(await snapshot(), beforeMaterialHistory, "guest counts, service windows and delivery locations are material, not historical contact-only exemptions");
  }
  const historicalBefore = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, legacy.canonicalId, historicalSaved.version, { action: "amend", reason: "Event requirements changed", patch: { ...historicalPatch, order: { ...historicalPatch.order, eventType: "event_catering" } } }), (error: any) => error.status === 422);
  assert.deepEqual(await snapshot(), historicalBefore, "changing event requirements must not bypass notice enforcement");
  const oldItemId = "hospitality-menu-item:merged:" + tag;
  await db.collection("integrationHubHospitalityMenuItemMerges").doc(stableDocumentId(oldItemId)).set({ sourceMenuItemId: oldItemId, survivorMenuItemId: sandwich });
  const mergedBooking = { ...historicalSaved, service: { ...historicalSaved.service, eventDate: earliestSandwichDelivery(new Date().toISOString()) }, order: { ...historicalSaved.order, items: historicalSaved.order.items.map((item: any) => ({ ...item, itemId: oldItemId, menuItemId: oldItemId })) } };
  await assert.rejects(db.runTransaction(transaction => assertHospitalityBookingDate(transaction, mergedBooking as any, new Date().toISOString())), (error: any) => error.status === 422 && error.code === "PRODUCT_NOTICE");
  const oldRollId = "hospitality-menu-item:historical:rice_paper_rolls";
  await db.collection("integrationHubHospitalityMenuItemMerges").doc(stableDocumentId(oldRollId)).set({ sourceMenuItemId: oldRollId, survivorMenuItemId: sandwich });
  const mergedRoll = { ...mergedBooking, service: { ...mergedBooking.service, eventDate: friday }, order: { ...mergedBooking.order, items: mergedBooking.order.items.map((item: any) => ({ ...item, itemId: oldRollId, menuItemId: oldRollId })) } };
  await assert.rejects(db.runTransaction(transaction => assertHospitalityBookingDate(transaction, mergedRoll as any, new Date().toISOString())), (error: any) => error.status === 422 && error.code === "SUMMER_ROLL_FRIDAY");
  const oldRcoaId = "RCOA-HISTORICAL-" + tag;
  await db.collection("fikaBookings").doc(canonicalBookingId(oldRcoaId, "rcoa")).set({ ...current, service: { ...current.service, portalSiteId: "rcoa" } });
  const beforeExisting = await snapshot();
  const existing = await existingPost(new NextRequest("http://test/api/bookings/mnk/existing", { method: "POST", headers: { "content-type": "application/json", "x-fika-mnk-bridge-token": "isolated-cutoff-test" }, body: JSON.stringify({ bookingIds: [oldRcoaId, "RCOA-MISSING"] }) }));
  assert.deepEqual(await existing.json(), { existingBookingIds: [oldRcoaId] });
  assert.deepEqual(await snapshot(), beforeExisting);
  const beforeGroup = await snapshot();
  await assert.rejects(amendHospitalityBookingGroup(actor, { bookingGroupId: groupId, expectedSourceHash: groupCommercialState(groupId, grouped).sourceHash, reason: "Test", services: grouped.map(child => ({ bookingId: child.canonicalId, expectedVersion: child.version, patch: { ...standardPatch, client: child.client } })) }, async () => {}), (e: any) => e.status === 422 && e.code === shortNoticeCode);
  assert.deepEqual(await snapshot(), beforeGroup, "group amendment rejects atomically before any child writes");

  const packageRoot = await mkdtemp(path.join(tmpdir(), "hospitality-admin-cutoff-"));
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = packageRoot;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    assert.equal(path.dirname(path.resolve(packageRoot)), path.resolve(tmpdir()));
    await rm(packageRoot, { recursive: true, force: true });
  });
  const principal = { type: "interactive" as const, id: `identity:staff:${tag}`, displayName: "Fixture staff", identityKind: "person" as const };
  const repository = new FirestoreAuthModRepository();
  const appId = "hospitality-booking";
  const timestamp = new Date().toISOString();
  const active = { status: "active" as const, version: 1, createdAt: timestamp, updatedAt: timestamp };
  const grantActor = { type: "interactive" as const, id: "identity:test-authmod-admin", displayName: "Fixture AUTHMOD administrator" };
  await repository.saveApplication(V1_APPLICATIONS.find(app => app.appId === appId)!);
  await repository.saveIdentity({ ...active, id: principal.id, displayName: principal.displayName, identityKind: "person", identityLinkStatus: "unmatched", fullAccess: true, provenance: "system" });
  await grantStandardApplicationAccess(repository, { identityId: principal.id, appId, actor: grantActor, reason: "Fixture app admission" });
  await rebuildOplocReadPackage();
  const authorizeAdmin = (booking: CanonicalBooking, transaction: Transaction) =>
    requireHospitalityBookingAdmin(new FirestoreAuthModRepository("hospitality-admin", undefined, transaction), principal, booking.service.oplocId);
  let near = addBusinessDate(ukBookingClock(new Date().toISOString()).date);
  while ([0, 6].includes(deliveryWeekday(near))) near = addBusinessDate(near);
  const staffPatch = { client: standardCurrent.client, service: { eventDate: near, startTime: "09:00", guestCount: 11 },
    order: { eventType: "lunch", items: [{ itemId: standard, unitPrice: 0, quantity: 11 }, { itemId: sandwich, unitPrice: 0, quantity: 2, itemName: "Untrusted name" }] } };
  const staffCommand = { action: "amend" as const, reason: "Urgent guest increase", patch: staffPatch };
  const beforeGrant = await snapshot();
  const unauthenticated = await dashboardPost(new NextRequest("http://test/api/hospitality-bookings", { method: "POST", body: JSON.stringify({ ...staffCommand, canonicalId: standardCurrent.canonicalId, expectedVersion: standardCurrent.version, hospitalityAdmin: true }) }));
  assert.equal(unauthenticated.status, 401);
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, staffCommand), { code: "PRODUCT_NOTICE" });
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, staffCommand, undefined, authorizeAdmin), { code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  assert.deepEqual(await snapshot(), beforeGrant, "Full Access and admin intent do not authorise a write without a direct grant");

  const grant = await grantAuthority(repository, { subjectId: principal.id, subjectType: "interactive", actor: grantActor, appId, resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage", scope: { kind: "organisation", ids: [] }, reason: "Fixture company Hospitality authority" });
  await setFullAccess(repository, { identityId: principal.id, fullAccess: false, actor: grantActor, reason: "Fixture remove Superuser before authorised amendment" });
  assert.deepEqual(await repository.listSiteAssignments(principal.id), []);

  const inactiveSite = "oploc:inactive:" + tag;
  await put(inactiveSite, "OPLOC", { approvedName: "Inactive fixture", lifecycleState: "inactive" });
  const staffBookingRef = db.collection("fikaBookings").doc(standardCurrent.canonicalId);
  await staffBookingRef.set({ ...standardCurrent, service: { ...standardCurrent.service, oplocId: inactiveSite } });
  const beforeInactiveSite = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, staffCommand, undefined, authorizeAdmin), { code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  assert.deepEqual(await snapshot(), beforeInactiveSite);
  await staffBookingRef.set({ ...standardCurrent, lifecycleStatus: "Cancelled" });
  const beforeCancelled = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, staffCommand, undefined, authorizeAdmin), /Cancelled bookings cannot be reopened/);
  assert.deepEqual(await snapshot(), beforeCancelled);
  await staffBookingRef.set(standardCurrent);
  const beforeStaff = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, { ...staffCommand, patch: { ...staffPatch, service: { ...staffPatch.service, eventDate: "2020-01-06" } } }, undefined, authorizeAdmin), { code: "HOSPITALITY_ADMIN_SERVICE_TIME" });
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, { ...staffCommand, patch: { ...staffPatch, dietaries: { severeAllergyAcknowledged: true } } }, undefined, authorizeAdmin), { code: "HOSPITALITY_ADMIN_DIETARY_REVIEW" });
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, { ...staffCommand, patch: { ...staffPatch, order: { ...staffPatch.order, eventType: "breakfast" } } }, undefined, authorizeAdmin), /not offered at this booking's OPLOC/);
  assert.deepEqual(await snapshot(), beforeStaff);
  const result = await executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, staffCommand, undefined, authorizeAdmin);
  assert.equal(result.booking.service.guestCount, 11);
  assert.deepEqual(result.booking.order.items.map(item => [item.menuItemId, item.itemName, item.unitPrice]), [[standard, "Test product", 1], [sandwich, "Test product", 1]]);
  assert.equal(result.booking.order.netTotal, 13);
  const audit = await db.collection("fikaBookingAudit").where("canonicalId", "==", standardCurrent.canonicalId).get();
  const override = audit.docs.find(doc => doc.data().hospitalityAdmin)?.data().hospitalityAdmin;
  assert.equal(override.source, "explicit-company-grant");
  assert.equal(override.grantId, grant.id);
  assert.equal(override.grantVersion, grant.version);
  assert.equal(override.identityId, principal.id);
  assert.equal(override.identityVersion, 2);
  assert.equal(override.beforePax, 10);
  assert.equal(override.afterPax, 11);
  assert.equal(override.noticeOverridden, true);
  const afterStaff = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, standardCurrent.version, staffCommand, undefined, authorizeAdmin), { status: 409 });
  assert.deepEqual(await snapshot(), afterStaff);

  const staffGroup = {
    bookingGroupId: groupId, expectedSourceHash: groupCommercialState(groupId, grouped).sourceHash,
    reason: "Amend both services", hospitalityAdmin: true as const,
    services: grouped.map(child => ({ bookingId: child.canonicalId, expectedVersion: child.version, patch: { ...staffPatch, client: child.client } })),
  };
  await assert.rejects(amendHospitalityBookingGroup(actor, staffGroup, async () => {}), { status: 403 });
  const spoofedGroup = structuredClone(staffGroup);
  Object.assign(spoofedGroup.services[0].patch.service, { oplocId: site });
  assert.equal(groupAmendmentCommand.safeParse(spoofedGroup).success, false, "an amendment cannot supply its own OPLOC");
  const invalidGroup = structuredClone(staffGroup);
  invalidGroup.services[1].patch.order.items[1].itemId = "hospitality-menu-item:unauthorised";
  await assert.rejects(amendHospitalityBookingGroup(actor, invalidGroup, async () => {}, authorizeAdmin), { status: 422 });
  assert.deepEqual(await snapshot(), afterStaff, "a rejected group never commits the earlier service");
  const savedGroup = await amendHospitalityBookingGroup(actor, staffGroup, async () => {}, authorizeAdmin);
  assert.deepEqual(savedGroup.bookings.map(booking => booking.service.guestCount), [11, 11]);
  assert.deepEqual(savedGroup.bookings.map(booking => booking.order.netTotal), [13, 13]);
  await setFullAccess(repository, { identityId: principal.id, fullAccess: true, actor: grantActor, reason: "Fixture restore Superuser before revocation" });
  await revokeAuthority(repository, { grantId: grant.id, actor: grantActor, reason: "Fixture company cover ended" });
  const afterRevocation = await snapshot();
  await assert.rejects(executeBookingWorkflow(actor, standardCurrent.canonicalId, result.booking.version, staffCommand, undefined, authorizeAdmin), { code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  await assert.rejects(amendHospitalityBookingGroup(actor, {
    ...staffGroup,
    expectedSourceHash: groupCommercialState(groupId, savedGroup.bookings).sourceHash,
    services: savedGroup.bookings.map(child => ({ bookingId: child.canonicalId, expectedVersion: child.version, patch: { ...staffPatch, client: child.client } })),
  }, async () => {}, authorizeAdmin), { code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  assert.deepEqual(await snapshot(), afterRevocation);
});
