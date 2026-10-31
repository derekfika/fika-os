import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { db } from "../lib/firebase-admin";
import { assertExpectedRcoaOploc, assertRcoaBookingServiceVisibility, canonicalBookingId, ingestMnkBooking, rcoaVisibilityAmendmentLines, type CanonicalBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { POST as bridgePost } from "../app/api/bookings/mnk/route";
import { effectiveServiceLayout } from "@fika/server-shared/hospitality-service-layout";
import { COMPANY_LAYOUT_ID, layoutCollection, layoutDocId, readBookingServiceLayout, type StoredServiceLayout } from "../lib/hospitality-service-layout";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Transaction } from "firebase-admin/firestore";
import type { CanonicalRecord } from "../lib/types";
import { randomUUID } from "node:crypto";

const RCOA_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const rcoaPayload = { bookingId: "RCOA-INGEST-1", siteId: "rcoa" } as unknown as MnkBookingPayload;

/** Records every Firestore access and outbound request attempted while `run` executes. */
async function withSideEffectSpies<T>(run: (attempts: string[]) => Promise<T>) {
  const attempts: string[] = [];
  const target = db as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  for (const method of ["runTransaction", "collection", "doc", "batch", "bulkWriter", "getAll", "collectionGroup"]) {
    originals.set(method, target[method]);
    target[method] = () => { attempts.push(`firestore.${method}`); throw new Error(`unexpected Firestore ${method}`); };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => { attempts.push(`fetch ${String(input)}`); throw new Error("unexpected outbound request"); }) as typeof fetch;
  try { return await run(attempts); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [method, original] of originals) target[method] = original;
  }
}

async function withBridgeToken<T>(token: string | undefined, run: () => Promise<T>) {
  const previous = process.env.MNK_CANON_BRIDGE_TOKEN;
  if (token === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN; else process.env.MNK_CANON_BRIDGE_TOKEN = token;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN; else process.env.MNK_CANON_BRIDGE_TOKEN = previous; }
}

const bridgeRequest = (headers: Record<string, string>, body: unknown = {}) =>
  new NextRequest("https://hub.test/api/bookings/mnk", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("RCoA is not gated by any rollout flag: a valid ingestion proceeds to the authoritative store", async () => {
  assert.deepEqual(Object.keys(process.env).filter((key) => /RCOA.*(SUBMISSION|ENABLED|OPEN|CLOSED)/i.test(key)), []);
  await withSideEffectSpies(async (attempts) => {
    await assert.rejects(ingestMnkBooking(rcoaPayload, RCOA_OPLOC), /Firestore/);
    assert.ok(attempts.some((attempt) => attempt.startsWith("firestore.")), `expected the ingestion transaction to start, saw ${JSON.stringify(attempts)}`);
  });
});

test("an RCoA submission without the governed expected-OPLOC header is refused before any store access or side effect", async () => {
  await withSideEffectSpies(async (attempts) => {
    await assert.rejects(ingestMnkBooking(rcoaPayload, undefined), (error: Error & { status?: number }) => error.status === 503 && /FIKA_RCOA_OPLOC_ID is not configured/.test(error.message));
    await assert.rejects(ingestMnkBooking(rcoaPayload, "   "), (error: Error & { status?: number }) => error.status === 503);
    assert.deepEqual(attempts, []);
  });
});

test("the governed RCoA destination must be mapped, equal to the configured OPLOC, and active", () => {
  assert.throws(() => assertExpectedRcoaOploc(RCOA_OPLOC, undefined), /confirmed Hub provider-location mapping/);
  assert.throws(() => assertExpectedRcoaOploc(RCOA_OPLOC, "oploc:someone-else", "oploc:someone-else"), /configuration mismatch/);
  assert.throws(() => assertExpectedRcoaOploc(RCOA_OPLOC, RCOA_OPLOC, undefined), /not an active canonical destination/);
  assert.equal(assertExpectedRcoaOploc(RCOA_OPLOC, RCOA_OPLOC, RCOA_OPLOC), RCOA_OPLOC);
});

test("the bridge rejects unauthenticated or wrongly authenticated RCoA submissions before any store access", async () => {
  await withSideEffectSpies(async (attempts) => {
    await withBridgeToken("expected-token", async () => {
      const missing = await bridgePost(bridgeRequest({ "x-fika-expected-rcoa-oploc-id": RCOA_OPLOC }, { siteId: "rcoa" }));
      assert.equal(missing.status, 401);
      const wrong = await bridgePost(bridgeRequest({ "x-fika-mnk-bridge-token": "not-the-token", "x-fika-expected-rcoa-oploc-id": RCOA_OPLOC }, { siteId: "rcoa" }));
      assert.equal(wrong.status, 401);
    });
    await withBridgeToken(undefined, async () => {
      const unconfigured = await bridgePost(bridgeRequest({ "x-fika-mnk-bridge-token": "anything" }, { siteId: "rcoa" }));
      assert.equal(unconfigured.status, 503);
    });
    assert.deepEqual(attempts, []);
  });
});

test("an authenticated but invalid RCoA payload is rejected with a client error and nothing is written", async () => {
  await withSideEffectSpies(async (attempts) => {
    await withBridgeToken("expected-token", async () => {
      const response = await bridgePost(bridgeRequest({ "x-fika-mnk-bridge-token": "expected-token", "x-fika-expected-rcoa-oploc-id": RCOA_OPLOC }, { bookingId: "RCOA-BAD", siteId: "rcoa", client: { name: "No Email" } }));
      assert.equal(response.status, 400);
    });
    assert.deepEqual(attempts, []);
  });
});

test("neither Hub nor production configuration carries an RCoA rollout flag", async () => {
  const { readFileSync } = await import("node:fs");
  for (const path of ["../apphosting.production.yaml", "../apphosting.staging.yaml", "../../hospitality-booking/apphosting.production.yaml", "../../hospitality-booking/apphosting.staging.yaml", "../lib/hospitality-booking-service.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /RCOA_BOOKING_SUBMISSIONS|assertBookingSubmissionOpen/, path);
  }
});

const fixturePayload = (): MnkBookingPayload => ({ bookingId: "RCOA-VISIBILITY-FIXTURE", submittedAt: "2026-10-31T20:00:00Z", siteId: "rcoa", site: "RCoA Hospitality", client: { name: "Fixture", email: "fixture@example.invalid", companyName: "Fixture" }, event: { eventDate: "2030-12-02", startTime: "12:00", guestCount: 12, floorLevel: "1", roomOrArea: "Room" }, order: { eventType: "breakfast", items: [{ itemId: "specialty_tea_coffee", category: "Wine", unitPrice: 0, quantity: 12, lineTotal: 0 }], netTotal: 0 } });
const company = (breakfast = ["Wine"]): StoredServiceLayout => ({ schema: 1, scope: "company", version: 1, services: { ...effectiveServiceLayout().company, breakfast: { categories: breakfast } }, createdAt: "fixture", createdBy: "test:fixture", updatedAt: "fixture", updatedBy: "test:fixture" });
const bookingFixture = (): CanonicalBooking => ({ canonicalId: "booking:rcoa:historical", service: { ...fixturePayload().event, portalSiteId: "rcoa", oplocId: RCOA_OPLOC }, order: { eventType: "breakfast", items: [{ itemId: "hospitality-menu-item:fixture-wine", category: "Wine", quantity: 2, unitPrice: 3, lineTotal: 6 }], netTotal: 6, vatTotal: 0, grossTotal: 6, currency: "GBP" } } as CanonicalBooking);

function layoutTransaction(documents: Array<StoredServiceLayout | undefined> = [company(), undefined]) {
  const reads: string[][] = [];
  const transaction = { getAll: async (...refs: Array<{ path: string }>) => { reads.push(refs.map(ref => ref.path)); return refs.map((_, index) => ({ exists: Boolean(documents[index]), data: () => documents[index] })); } } as unknown as Transaction;
  return { transaction, reads };
}

test("booking layout reads exactly company plus selected site; absent overrides use the governed seed and malformed authority stays closed", async () => {
  const missing = layoutTransaction([undefined, undefined]);
  assert.deepEqual((await readBookingServiceLayout(missing.transaction, RCOA_OPLOC)).company, effectiveServiceLayout().company);
  assert.deepEqual(missing.reads[0], [`integrationHubHospitalityServiceLayout/${COMPANY_LAYOUT_ID}`, `integrationHubHospitalityServiceLayout/${layoutDocId(RCOA_OPLOC)}`]);
  const invalid = layoutTransaction([{ ...company(), services: {} }, undefined]);
  await assert.rejects(readBookingServiceLayout(invalid.transaction, RCOA_OPLOC), /settings are invalid/);
});

test("category validation uses canonical authority, not the category text in an amendment payload", async () => {
  const booking = bookingFixture(); booking.order.items[0].category = "Drinks";
  const authority = [{ canonicalId: booking.order.items[0].itemId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", dataHash: "fixture", record: { lifecycleState: "active", category: "Wine" } }] as CanonicalRecord[];
  const f = layoutTransaction([company(["Drinks"]), undefined]);
  await assert.rejects(assertRcoaBookingServiceVisibility(f.transaction, booking, authority), /not offered/);
  assert.equal(f.reads.length, 1);
  booking.order.eventType = "dining";
  const allowed = layoutTransaction([{ ...company(), services: { ...company().services, dining: { categories: ["Wine"] } } }, undefined]);
  assert.equal((await assertRcoaBookingServiceVisibility(allowed.transaction, booking, authority))?.get(booking.order.items[0].itemId), "Wine", "changed-line snapshots use the verified category rather than client wording");
});

test("unchanged historical lines survive non-line amendments; added/increased lines and changed service/site use current visibility", async () => {
  const current = bookingFixture(), next = structuredClone(current);
  next.service.eventDate = "2030-12-03"; next.service.startTime = "13:00"; next.service.guestCount = 25; next.service.roomOrArea = "Another room"; next.notes = "Contact correction";
  assert.deepEqual(rcoaVisibilityAmendmentLines(current, next), []);
  const idle = layoutTransaction();
  await assertRcoaBookingServiceVisibility(idle.transaction, next, [], current);
  assert.deepEqual(idle.reads, [], "historical snapshots do not gain new config reads or rewriting");
  const authority = [{ canonicalId: current.order.items[0].itemId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", dataHash: "fixture", record: { lifecycleState: "active", category: "Wine" } }] as CanonicalRecord[];
  next.order.items[0].quantity = 3;
  await assert.rejects(assertRcoaBookingServiceVisibility(layoutTransaction([company(["Drinks"]), undefined]).transaction, next, authority, current), /not offered/);
  next.order.items[0].quantity = 1;
  assert.deepEqual(rcoaVisibilityAmendmentLines(current, next), [], "reducing an old line is permitted without enabling more demand");
  next.order.items.push({ ...next.order.items[0], itemId: "new-item" });
  assert.equal(rcoaVisibilityAmendmentLines(current, next).length, 1);
  next.order.items.pop(); next.order.eventType = "dining";
  assert.equal(rcoaVisibilityAmendmentLines(current, next).length, 1);
});

/** Executes the real ingestion callback with inert transaction reads/writes; no Firestore/network is used. */
async function withInertIngestion<T>(existing: CanonicalBooking | undefined, run: (writes: string[], reads: string[]) => Promise<T>) {
  const target = db as unknown as { runTransaction: unknown }, original = target.runTransaction, originalFetch = globalThis.fetch;
  const writes: string[] = [], reads: string[] = [];
  target.runTransaction = async (fn: (transaction: Transaction) => Promise<T>) => {
    let number = 0;
    const transaction = { get: async (ref: { path?: string }) => {
      reads.push(ref.path || "query"); number++;
      if (number === 1) return { exists: Boolean(existing), data: () => existing };
      if (number === 2) return { size: 0, docs: [] };
      if (number === 3) return { size: 1, docs: [{ data: () => ({ sourceIdentifier: "rcoa", sourceEntityType: "provider-location", mappingStatus: "confirmed", targetCanonicalId: RCOA_OPLOC }) }] };
      return { exists: true, data: () => ({ canonicalId: RCOA_OPLOC, entityType: "OPLOC", lifecycleStatus: "published", record: { lifecycleState: "active" } }) };
    }, getAll: async (...refs: Array<{ path: string }>) => { reads.push(...refs.map(ref => ref.path)); return [{ exists: true, data: () => company() }, { exists: false }]; }, create: (...args: unknown[]) => { writes.push("create"); throw new Error("Unexpected write"); }, set: () => { writes.push("set"); throw new Error("Unexpected write"); }, update: () => { writes.push("update"); throw new Error("Unexpected write"); } } as unknown as Transaction;
    return fn(transaction);
  };
  globalThis.fetch = (async () => { writes.push("network"); throw new Error("Unexpected network"); }) as typeof fetch;
  try { return await run(writes, reads); } finally { target.runTransaction = original; globalThis.fetch = originalFetch; }
}

test("real Hub ingestion rejects a disallowed new category before booking, audit, notification, CPU or outbox writes", async () => {
  await withInertIngestion(undefined, async (writes, reads) => {
    await assert.rejects(ingestMnkBooking(fixturePayload(), RCOA_OPLOC), /not offered/);
    assert.deepEqual(writes, []);
    assert.equal(reads.filter(path => path.startsWith("integrationHubHospitalityServiceLayout/")).length, 2);
  });
});
test("existing-only replay returns the existing canonical id unchanged; absent ids cannot create, and non-RCoA mode is refused", async () => {
  const existing = bookingFixture(), before = structuredClone(existing);
  await withInertIngestion(existing, async (writes, reads) => {
    const payload = fixturePayload(); payload.order.items[0].quantity = 999; payload.client.name = "Altered replay";
    const result = await ingestMnkBooking(payload, RCOA_OPLOC, true);
    assert.equal(result.created, false); assert.equal(result.booking.canonicalId, existing.canonicalId); assert.deepEqual(existing, before);
    assert.deepEqual(writes, []); assert.equal(reads.length, 1);
  });
  await withInertIngestion(undefined, async (writes, reads) => {
    await assert.rejects(ingestMnkBooking(fixturePayload(), RCOA_OPLOC, true), /No booking was created/);
    assert.deepEqual(writes, []); assert.equal(reads.length, 1);
    await assert.rejects(ingestMnkBooking({ ...fixturePayload(), siteId: "mnk" }, undefined, true), /requires the RCoA/);
    assert.equal(reads.length, 1);
  });
});

const emulator = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
test("emulator: RCoA category rejection is atomic and historical replay causes no business writes", { skip: !emulator }, async () => {
  const payload = { ...fixturePayload(), bookingId: `RCOA-VIS-${randomUUID()}` }, id = canonicalBookingId(payload.bookingId, "rcoa");
  const destination = db.collection("integrationHubCanonical").doc(stableDocumentId(RCOA_OPLOC));
  const mapping = db.collection("integrationHubSourceMappings").doc("fixture-rcoa-visibility");
  const companyRef = layoutCollection().doc(COMPANY_LAYOUT_ID);
  await destination.set({ canonicalId: RCOA_OPLOC, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } });
  await mapping.set({ sourceIdentifier: "rcoa", sourceEntityType: "provider-location", mappingStatus: "confirmed", targetCanonicalId: RCOA_OPLOC });
  await companyRef.set(company());
  const counts = async () => Promise.all(["fikaBookings", "fikaBookingAudit", "fikaBookingNotifications", "fikaProductionOrders", "integrationHubDomainEventOutbox"].map(async collection => [collection, (await db.collection(collection).get()).size]));
  const before = await counts();
  await assert.rejects(ingestMnkBooking(payload, RCOA_OPLOC), /not offered/);
  assert.deepEqual(await counts(), before);
  const existing = { ...bookingFixture(), canonicalId: id };
  await db.collection("fikaBookings").doc(id).set(existing);
  const priorReplay = await counts();
  assert.equal((await ingestMnkBooking({ ...payload, order: { ...payload.order, eventType: "unknown" } }, RCOA_OPLOC, true)).created, false);
  assert.deepEqual(await counts(), priorReplay);
  assert.deepEqual((await db.collection("fikaBookings").doc(id).get()).data(), existing);
});
