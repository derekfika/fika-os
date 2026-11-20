import assert from "node:assert/strict";
import test from "node:test";
import { ROTATIONS_AUTHORITY } from "../../shared/hospitality-rotations";
import {
  createAuthIdentity, grantAuthority, grantStandardApplicationAccess, HOSPITALITY_BOOKING_ADMIN,
  MemoryAuthModRepository, revokeAuthority, V1_APPLICATIONS,
} from "../lib/authmod-core";
import { requireStudioImpactAccess, studioImpactMode } from "../lib/hospitality-studio-impact/authorization";
import { futureBookingImpact, impactRequest, type ImpactRequest } from "../lib/hospitality-studio-impact/impact";

const target = "hospitality-menu-item:studio-test-bowls";
const other = "hospitality-menu-item:studio-test-sandwiches";
const previous = "hospitality-menu-item:studio-test-old-bowls";
const site = "oploc:studio-impact-test";
const input: ImpactRequest = {
  firstEventDate: "2026-07-01", lastEventDate: "2026-07-05", catalogueItemIds: [target], scope: "catalogue-item",
};
const now = new Date("2026-07-01T23:30:00Z");

function booking(id: string, lifecycleStatus: string, menuItemId?: string, eventDate = "2026-07-02", oplocId: string | null = site) {
  return {
    entityType: "Booking", canonicalId: id, lifecycleStatus,
    service: { eventDate, ...(oplocId ? { oplocId } : {}), onsiteContactName: "private contact" },
    order: { items: [{ menuItemId, itemId: "legacy opaque id", itemName: "untrusted display text" }] },
    client: { name: "private customer" }, kitchenNotes: "private kitchen notes",
  };
}

const labels = async () => new Map([[target, "Canonical bowl selection"], [other, "Canonical sandwich selection"]]);
const siteLabels = async () => new Map([[site, "Governed site"]]);

test("booking impact uses the London event window and returns only confirmed matched catalogue selections", async () => {
  const result = await futureBookingImpact({
    async bookings(from, through) {
      assert.equal(from, "2026-07-02");
      assert.equal(through, "2026-07-05");
      return { truncated: false, rows: [
        booking("booking-approved", "Approved", previous),
        booking("booking-cpu", "Sent to CPU", target),
        booking("booking-different-product", "Approved", other),
        booking("booking-cancelled", "Cancelled", target),
        booking("booking-quote", "Quoted", target),
      ] };
    },
    async resolveItems(ids) { return new Map(ids.map(id => [id, id === previous ? target : id])); },
    itemLabels: labels, siteLabels,
  }, input, now);
  assert.deepEqual(result, {
    scope: "catalogue-item", coverage: "complete", reasons: [],
    bookings: ["booking-approved", "booking-cpu"].map(id => ({
      id, eventDate: "2026-07-02", site: "Governed site", selectionIds: [target], selections: ["Canonical bowl selection"],
    })),
  });
});

test("partial windows, unresolved identities and missing dish evidence never become a verified zero", async () => {
  const result = await futureBookingImpact({
    async bookings() {
      const legacy = booking("legacy", "Approved");
      legacy.order.items[0].itemId = target;
      return { rows: [legacy, booking("parent", "Approved", target, "2026-07-02", null)], truncated: true };
    },
    async resolveItems(ids) { return new Map(ids.map(id => [id, id])); },
    itemLabels: labels, siteLabels,
  }, { ...input, scope: "dish-selection" }, now);
  assert.equal(result.coverage, "partial");
  assert.deepEqual(result.reasons, [
    "BOOKING_WINDOW_TRUNCATED", "BOOKING_IDENTITY_UNAVAILABLE", "DISH_SELECTION_EVIDENCE_UNAVAILABLE", "SITE_UNAVAILABLE",
  ]);
  assert.deepEqual(result.bookings, [{
    id: "parent", eventDate: "2026-07-02", site: "Site unavailable",
    selectionIds: [target], selections: ["Canonical bowl selection"],
  }]);
  assert.equal(impactRequest.safeParse({ ...input, firstEventDate: "2027-02-29" }).success, false);
  assert.equal(impactRequest.safeParse({ ...input, lastEventDate: "2028-01-01" }).success, false);
  assert.equal(impactRequest.safeParse({ ...input, catalogueItemIds: ["/private/path"] }).success, false);
});

test("impact needs both rotation management and a direct company-wide booking grant", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS] });
  const actor = { type: "interactive" as const, id: "authmod:fixture-admin", displayName: "Fixture admin" };
  const identity = await createAuthIdentity(repository, {
    actor, displayName: "Fixture editor", legendId: "legend:fixture-impact", externalProvider: "firebase",
    externalUid: "fixture-impact", provenance: "migration",
  });
  const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName };
  await grantStandardApplicationAccess(repository, {
    identityId: identity.id, appId: "hospitality-booking", actor, reason: "Fixture Hospitality admission",
  });
  const grantInput = {
    actor, subjectType: "interactive" as const, subjectId: identity.id, appId: "hospitality-booking",
    scope: { kind: "organisation" as const, ids: [] }, action: "Manage" as const, reason: "Fixture impact authorisation",
  };
  const rotations = await grantAuthority(repository, { ...grantInput, ...ROTATIONS_AUTHORITY });
  await assert.rejects(requireStudioImpactAccess(repository, principal), { code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  await assert.rejects(requireStudioImpactAccess(repository, principal, async () => true), { code: "AUTHMOD_HOSPITALITY_ADMIN_DENIED" });
  const company = await grantAuthority(repository, { ...grantInput, resource: HOSPITALITY_BOOKING_ADMIN });
  await requireStudioImpactAccess(repository, principal);
  await revokeAuthority(repository, { actor, grantId: rotations.id, reason: "Fixture revocation" });
  await assert.rejects(requireStudioImpactAccess(repository, principal), { status: 403 });
  await assert.rejects(requireStudioImpactAccess(repository, principal, async () => false), { code: "STUDIO_ACCESS_DENIED" });
  await requireStudioImpactAccess(repository, principal, async () => true);
  await revokeAuthority(repository, { actor, grantId: company.id, reason: "Fixture cleanup" });
});

test("impact is restricted to the staging Hub and a loopback demo emulator", () => {
  const stage = { NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev",
    FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com" } as const;
  assert.equal(studioImpactMode("staging-os.fikacatering.com", stage), "staging");
  assert.equal(studioImpactMode("os.fikacatering.com", stage), undefined);
  assert.equal(studioImpactMode("os.fikacatering.com", {
    ...stage, FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os",
  }), undefined);
  const local = { NODE_ENV: "test", FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os" } as const;
  assert.equal(studioImpactMode("localhost:3100", local), undefined);
  assert.equal(studioImpactMode("localhost:3100", { ...local, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8292" }), "local");
});
