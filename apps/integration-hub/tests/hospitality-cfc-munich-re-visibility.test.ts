import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { effectiveServiceLayout } from "@fika/server-shared/hospitality-service-layout";
import type { CanonicalBooking } from '../lib/hospitality-booking-service';
import type { CanonicalRecord } from '../lib/types';
import type { StoredServiceLayout } from "../lib/hospitality-service-layout";
import { assertMappedBookingServiceVisibility, resolveHospitalityDestinationId } from "../lib/hospitality-booking-service";
import { resolvePublicHospitalityOploc } from "../lib/hospitality-public-site";
import type { Transaction } from "firebase-admin/firestore";

const site = "oploc:cfc";
const itemId = "hospitality-menu-item:coffee";
const company: StoredServiceLayout = { schema: 1, scope: "company", version: 1, services: effectiveServiceLayout().company, createdAt: "test", createdBy: "test", updatedAt: "test", updatedBy: "test" };
const item = { canonicalId: itemId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "fixture", record: { lifecycleState: "active", category: "Drinks" } } as CanonicalRecord;
const booking = (siteId = "cfc", category = "Forged category"): CanonicalBooking => ({ canonicalId: "booking:test", service: { portalSiteId: siteId, oplocId: site, eventDate: "2030-12-02", startTime: "12:00", guestCount: 10 }, order: { eventType: "breakfast", items: [{ itemId, category, quantity: 2, unitPrice: 5, lineTotal: 10 }], netTotal: 10 } } as CanonicalBooking);

function transaction(layout: StoredServiceLayout | undefined = company) {
  let reads = 0;
  const tx = { getAll: async () => { reads++; return [{ exists: true, data: () => layout }, { exists: false }]; } } as unknown as Transaction;
  return { tx, reads: () => reads };
}

test("public site resolution accepts only an exact unique confirmed stable-key mapping to an active OPLOC", () => {
  const mapping = { sourceIdentifier: "cfc", sourceEntityType: "provider-location", mappingStatus: "confirmed", targetCanonicalId: site };
  const oploc = { canonicalId: site, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "fixture", record: { lifecycleState: "active" } } as CanonicalRecord;
  assert.equal(resolvePublicHospitalityOploc("cfc", [mapping], [oploc]), site);
  assert.equal(resolvePublicHospitalityOploc("munich-re", [mapping], [oploc]), undefined);
  assert.equal(resolvePublicHospitalityOploc("cfc", [mapping, mapping], [oploc]), undefined);
  assert.equal(resolvePublicHospitalityOploc("cfc", [{ ...mapping, mappingStatus: "pending" }], [oploc]), undefined);
  assert.equal(resolvePublicHospitalityOploc("cfc", [mapping], [{ ...oploc, record: { lifecycleState: "archived" } }]), undefined);
});

test("CFC and Munich RE require canonical Item categories offered at the mapped site and service", async () => {
  for (const siteId of ["cfc", "munich-re"]) {
    const f = transaction();
    const verified = await assertMappedBookingServiceVisibility(f.tx, booking(siteId), [item]);
    assert.equal(verified?.get(itemId), "Drinks", "client category text never wins over canonical Item data");
  }
  const unavailable = transaction({ ...company, services: { ...company.services, breakfast: { categories: ["Breakfast"] } } });
  await assert.rejects(assertMappedBookingServiceVisibility(unavailable.tx, booking(), [item]), /not offered/);
  await assert.rejects(assertMappedBookingServiceVisibility(transaction().tx, booking("cfc"), []), /not available in the governed catalogue/);
});

test("non-demand historical edits do not revalidate saved lines; increases do", async () => {
  const current = booking();
  const contactEdit = structuredClone(current);
  contactEdit.service.eventDate = "2030-12-03";
  await assertMappedBookingServiceVisibility(transaction({ ...company, services: { ...company.services, breakfast: { categories: ["Breakfast"] } } }).tx, contactEdit, [], current);
  const increased = structuredClone(current);
  increased.order.items[0]!.quantity++;
  await assert.rejects(assertMappedBookingServiceVisibility(transaction({ ...company, services: { ...company.services, breakfast: { categories: ["Breakfast"] } } }).tx, increased, [item], current), /not offered/);
});

test("booking POST uses the same unique stable-key provider-location mapping as public site resolution", () => {
  const mapping = { sourceIdentifier: "cfc", sourceEntityType: "provider-location", mappingStatus: "confirmed", targetCanonicalId: site };
  assert.equal(resolveHospitalityDestinationId({ siteId: "cfc", site: "CFC Underwriting" }, [mapping]), site);
  assert.equal(resolveHospitalityDestinationId({ siteId: "cfc", site: "CFC Underwriting" }, [mapping, { ...mapping, targetCanonicalId: "oploc:other" }]), undefined);
  assert.equal(resolveHospitalityDestinationId({ siteId: "cfc", site: "CFC Underwriting" }, [{ ...mapping, sourceIdentifier: "cfc underwriting" }]), undefined);
  assert.equal(resolveHospitalityDestinationId({ siteId: "cfc", site: "CFC Underwriting" }, [{ ...mapping, sourceEntityType: "other" }]), undefined);
});

test("changed legacy amendment demand resolves only through a unique site provider mapping", async () => {
  const legacyId = "old-cfc-coffee";
  const mapped = { ...item, record: { ...item.record, providerMappings: [{ provider: "cfc-hospitality-brochure", sourceItemId: legacyId }] } } as CanonicalRecord;
  const next = booking();
  next.order.items[0]!.itemId = legacyId;
  const current = structuredClone(next);
  next.order.items[0]!.quantity++;
  const allowed = await assertMappedBookingServiceVisibility(transaction().tx, next, [mapped], current);
  assert.equal(allowed?.get(legacyId), "Drinks");
  const ambiguous = { ...mapped, canonicalId: "hospitality-menu-item:duplicate" } as CanonicalRecord;
  await assert.rejects(assertMappedBookingServiceVisibility(transaction().tx, next, [mapped, ambiguous], current), /not uniquely linked/);
  await assert.rejects(assertMappedBookingServiceVisibility(transaction().tx, next, [item], current), /not uniquely linked/);
});
test("emulator: disallowed CFC service category rejection writes no booking", { skip: !(process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) }, async () => {
  const id = randomUUID();
  const storedItemId = "hospitality-menu-item:emulator-visibility-fixture";
  const itemRef = db.collection("integrationHubCanonical").doc(stableDocumentId(storedItemId));
  const companyRef = db.collection("integrationHubHospitalityServiceLayout").doc("company");
  const bookingRef = db.collection("fikaBookings").doc(`booking:cfc:visibility-${id}`);
  const restrictedCompany = { ...company, services: { ...company.services, breakfast: { categories: ["Breakfast"] } } };
  await companyRef.set(restrictedCompany);
  await itemRef.set({ ...item, canonicalId: storedItemId });
  try {
    await assert.rejects(db.runTransaction(async tx => {
      const attempted = booking();
      attempted.order.items[0]!.itemId = storedItemId;
      await assertMappedBookingServiceVisibility(tx, attempted, []);
      tx.create(bookingRef, { canonicalId: bookingRef.id });
    }), /not offered/);
    assert.equal((await bookingRef.get()).exists, false);
  } finally {
    await Promise.all([companyRef.delete(), itemRef.delete(), bookingRef.delete()]);
  }
});