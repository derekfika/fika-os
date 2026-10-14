import assert from "node:assert/strict";
import test from "node:test";
import { BOOKING_IDENTITY_SCHEME, calendarBookingIdentity, portalBookingIdentity } from "../lib/hospitality-booking-identity";
import { buildHospitalityPortalBooking, buildCalendarCanonicalBooking, ingestMnkBookingFromExisting, resolveHospitalityDestinationOploc, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { bookingNotificationId } from "../lib/booking-notifications";
import { productionOrderV1Id, productionRequirementId } from "../lib/production-domain";
import type { CanonicalRecord } from "../lib/types";

const menuProviders = { mnk: "mnk-booking-platform", "angel-court": "angel-court-hospitality-brochure", cfc: "cfc-hospitality-brochure", "munich-re": "munich-re-generic-brochure", rcoa: "rcoa-hospitality-brochure" };
const payloadFor = (siteId: string): MnkBookingPayload => ({
  bookingId: `PORTAL-${siteId}`, siteId, site: siteId === "angel-court" ? "One Angel Court" : siteId,
  submittedAt: "2026-10-14T12:00:00Z", client: { name: "Test Host", companyName: "Test", email: "host@example.test" },
  event: { eventDate: "2026-11-03", startTime: "12:00", guestCount: 10 },
  order: { items: [{ itemId: "source-item", quantity: 10, unitPrice: 1, lineTotal: 10 }], netTotal: 10 },
});
const menuFor = (site: keyof typeof menuProviders): CanonicalRecord => ({ canonicalId: `hospitality-menu-item:${site}:test`, entityType: "Hospitality Menu Item", dataHash: "test", lifecycleStatus: "published", record: { name: "Test Item", lifecycleState: "active", unitPrice: 12, providerMappings: [{ provider: menuProviders[site], sourceItemId: "source-item" }] } });
const oploc = (id: string): CanonicalRecord => ({ canonicalId: id, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active" } });
const mappingFor = (site: string) => ({ sourceProvider: "hospitality-booking-platform", sourceEntityType: "provider-location", sourceIdentifier: site, mappingStatus: "confirmed", oplocId: `oploc:${site}-governed` });

for (const site of Object.keys(menuProviders) as Array<keyof typeof menuProviders>) {
  test(`${site}: truthful new provenance, frozen namespace, separate site and unchanged menu provider`, () => {
    const payload = payloadFor(site);
    const booking = buildHospitalityPortalBooking(payload, [menuFor(site)]).booking;
    assert.equal(booking.source.provider, site === "rcoa" ? "rcoa-booking-platform" : "hospitality-booking-platform");
    assert.deepEqual(booking.source.identity, { scheme: BOOKING_IDENTITY_SCHEME, namespace: site === "rcoa" ? "rcoa-booking-platform" : "mnk-booking-platform" });
    assert.equal(booking.canonicalId, portalBookingIdentity(payload.bookingId, site).canonicalId);
    assert.equal(booking.service.portalSiteId, site);
    assert.equal(booking.service.portalSiteLabel, payload.site);
    assert.equal(booking.order.items[0].menuItemId, menuFor(site).canonicalId);
    assert.equal(booking.source.contractVersion, site === "rcoa" ? "fika.booking-ingestion.rcoa.v1" : "fika.booking-ingestion.mnk.v1");
    assert.equal(booking.createdBy, `bridge:${booking.source.provider}`);
    if (site !== "rcoa") assert.doesNotMatch(booking.statusHistory[0].reason + booking.audit[0].reason, /MNK/);
  });
}

test("identity API freezes pre-transition golden IDs and trimming independently of provenance", () => {
  assert.equal(portalBookingIdentity(" MNK-ONE ", "mnk").canonicalId, "booking:mnk:a60b2ecb2b226c4d56b61460830a38a6");
  assert.equal(portalBookingIdentity("ANGEL-ONE", "angel-court").canonicalId, "booking:mnk:69a1b189cf46d80637fbe8663f2c23b3");
  assert.equal(portalBookingIdentity("RCOA-20261005103000-AB12", "rcoa").canonicalId, "booking:rcoa:914cffc5ac892755170676fbbb39da3f");
});

test("old-provider replay returns the same historical Booking without adding identity metadata or rewriting audit", () => {
  for (const site of ["mnk", "angel-court", "cfc", "munich-re"] as const) {
    const payload = payloadFor(site);
    const old = buildHospitalityPortalBooking(payload, [menuFor(site)]).booking;
    old.source.provider = "mnk-booking-platform";
    delete old.source.identity;
    delete old.service.portalSiteId; // compatibility can recover site from immutable source evidence
    old.createdBy = "bridge:mnk-booking-platform";
    const before = structuredClone(old);
    const result = ingestMnkBookingFromExisting(old, payload, [], undefined, "oploc:other");
    assert.equal(result.created, false);
    assert.strictEqual(result.booking, old);
    assert.deepEqual(result.booking, before);
    const legacyPayload = { ...payload, siteId: "oploc:historic", site: site === "mnk" ? "MNK" : site === "angel-court" ? "Angel Court" : site === "cfc" ? "CFC" : "Munich Re" };
    assert.strictEqual(ingestMnkBookingFromExisting(old, legacyPayload, []).booking, old);
  }
});

test("a shared legacy namespace collision across sites fails closed instead of returning another site's booking", () => {
  const first = payloadFor("angel-court");
  const existing = buildHospitalityPortalBooking(first, [menuFor("angel-court")]).booking;
  const collision = { ...payloadFor("cfc"), bookingId: first.bookingId };
  assert.equal(portalBookingIdentity(first.bookingId, "angel-court").canonicalId, portalBookingIdentity(collision.bookingId, "cfc").canonicalId);
  assert.throws(() => ingestMnkBookingFromExisting(existing, collision, []), /different booking identity or portal site/);
});

test("all shared sites require their own exact confirmed application/provider-location key and active OPLOC", () => {
  for (const site of ["mnk", "angel-court", "cfc", "munich-re"]) {
    const mapping = mappingFor(site);
    const record = oploc(mapping.oplocId);
    const payload = payloadFor(site);
    assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [record]), record.canonicalId);
    for (const wrong of [
      { ...mapping, sourceProvider: "mnk-booking-platform" },
      { ...mapping, sourceEntityType: "site-label" },
      { ...mapping, mappingStatus: "historical" },
      { ...mapping, sourceIdentifier: `Display label for ${site}` },
      { ...mapping, sourceIdentifier: "other" },
      { ...mapping, oplocId: "oploc:missing" },
    ]) {
      assert.equal(resolveHospitalityDestinationOploc(payload, [wrong], [record]), undefined);
    }
    assert.equal(resolveHospitalityDestinationOploc(payload, [mapping, { ...mapping }], [record]), undefined);
    assert.equal(resolveHospitalityDestinationOploc({ site: payload.site }, [mapping], [record]), undefined);
    assert.equal(resolveHospitalityDestinationOploc(payload, [], [record]), undefined);
    assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [{ ...record, record: { lifecycleState: "archived" } }]), undefined);
    assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [{ ...record, publicationStatus: "withdrawn" }]), undefined);
    assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [{ ...record, entityType: "Address" }]), undefined);
    assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [{ ...record, lifecycleStatus: "archived" }]), undefined);
  }
});

test("Calendar hash, provider and legacy destination mapping policy remain independent of portal provenance", () => {
  const payload = { ...payloadFor("angel-court"), bookingId: "calendar:cpux@fikacatering.com:event-1" };
  const booking = buildCalendarCanonicalBooking(payload, [menuFor("angel-court")]).booking;
  assert.equal(booking.source.provider, "mnk-booking-platform");
  assert.equal(booking.canonicalId, "booking:mnk:519aacb4ed35af3e271d9ff66f9fceaa");
  assert.equal(booking.canonicalId, calendarBookingIdentity(payload.bookingId, "angel-court").canonicalId);
  assert.equal(booking.source.identity?.namespace, "mnk-booking-platform");
  assert.equal(ingestMnkBookingFromExisting(booking, payload, [], undefined, undefined, "calendar").created, false);
  assert.throws(() => ingestMnkBookingFromExisting(booking, payload, []), /different booking identity/);
  const mapping = { ...mappingFor("angel-court"), sourceProvider: "rota", sourceEntityType: "site-label", sourceIdentifier: "one angel court" };
  assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [oploc(mapping.oplocId)], "calendar"), mapping.oplocId);
  assert.equal(resolveHospitalityDestinationOploc(payload, [mapping], [oploc(mapping.oplocId)]), undefined);
});

test("provider transition does not change quote, production, requirement or notification identities", () => {
  const payload = payloadFor("angel-court");
  const next = buildHospitalityPortalBooking(payload, [menuFor("angel-court")]).booking;
  const old = structuredClone(next);
  old.source.provider = "mnk-booking-platform";
  delete old.source.identity;
  const quote = `quote:${old.canonicalId}:r1`;
  assert.equal(`quote:${next.canonicalId}:r1`, quote);
  assert.equal(productionOrderV1Id(next.canonicalId), productionOrderV1Id(old.canonicalId));
  assert.equal(productionRequirementId(next.canonicalId, quote), productionRequirementId(old.canonicalId, quote));
  for (const kind of ["submitted", "confirmed", "amended", "cancelled"] as const)
    assert.equal(bookingNotificationId(next, kind, 3), bookingNotificationId(old, kind, 3));
});
