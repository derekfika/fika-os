import assert from "node:assert/strict";
import test from "node:test";
import { assertCpuXCalendarQuoteAccess, calendarQuoteOplocId, cpuXCalendarQuoteContext } from "../lib/cpux-calendar-quote";
import type { ProductionOrder } from "../lib/production-domain";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";
import { MemoryAuthModRepository } from "../lib/authmod-core/memory-repository";
import type { ApplicationRegistryEntry, AuthIdentity, AuthPrincipal } from "../lib/authmod-core/model";
import { grantStandardApplicationAccess, assignSite } from "../lib/authmod-core/grants";

const bookingId = "booking:quote-fixture";
const base = `production-order:v1:${bookingId}`;
const revision = { id: "quote:1", revision: 1, commercialVersion: 3, stale: false, pdfStatus: "saved", driveFileId: "saved-pdf-one" };
const booking = (extra = {}) => ({ canonicalId: bookingId, commercialVersion: 3, lifecycleStatus: "Sent to CPU", service: { oplocId: "oploc:site" }, quoteState: { currentRevisionId: revision.id, revisions: [revision] }, ...extra } as unknown as CanonicalBooking);
const order = (extra = {}) => ({ canonicalId: base, origin: "hospitality_booking", sourceBookingId: bookingId, sourceQuoteRevisionId: revision.id, status: "draft", version: 1, ...extra } as ProductionOrder);

test("existing immutable quote PDF resolves by exact handed-off revision, without creating or mutating files", async () => {
  const authority = booking();
  const before = JSON.stringify(authority);
  const calls: string[] = [];
  const context = await cpuXCalendarQuoteContext(bookingId, {
    order: async id => { calls.push(`order:${id}`); return order(); },
    booking: async id => { calls.push(`booking:${id}`); return authority; },
  });
  assert.equal(context.quote?.url, "https://drive.google.com/file/d/saved-pdf-one/view");
  assert.deepEqual(calls, [`order:${base}`, `booking:${bookingId}`]);
  assert.equal(JSON.stringify(authority), before);
});

test("amendment follows existing replacement lineage to the new saved PDF and preserves historical metadata", async () => {
  const second = { ...revision, id: "quote:2", revision: 2, driveFileId: "saved-pdf-two", groupQuoteId: "group:quote:2" };
  const authority = booking({ quoteState: { currentRevisionId: second.id, revisions: [{ ...revision, stale: true }, second] } });
  const before = JSON.stringify(authority);
  const context = await cpuXCalendarQuoteContext(bookingId, {
    order: async id => id === base ? order({ status: "amended", supersededBy: `${base}:r8` }) : order({ canonicalId: `${base}:r8`, sourceQuoteRevisionId: second.id }),
    booking: async () => authority,
  });
  assert.equal(context.order.canonicalId, `${base}:r8`);
  assert.equal(context.quote?.driveFileId, "saved-pdf-two");
  assert.equal(JSON.stringify(authority), before);
});

test("stale, pending, absent, cross-version and unhanded-off quote evidence never resolves as current", async () => {
  for (const change of [
    { stale: true }, { pdfStatus: "pending" }, { pdfStatus: "failed" }, { driveFileId: "" },
    { commercialVersion: 2 }, { driveFileId: "invalid/id" }, { id: "quote:other" },
  ]) {
    const authority = booking({ quoteState: { currentRevisionId: revision.id, revisions: [{ ...revision, ...change }] } });
    assert.equal((await cpuXCalendarQuoteContext(bookingId, { order: async () => order(), booking: async () => authority })).quote, undefined);
  }
  for (const status of ["cancelled", "rejected", "amended"]) {
    assert.equal((await cpuXCalendarQuoteContext(bookingId, { order: async () => order({ status }), booking: async () => booking() })).quote, undefined);
  }
  assert.equal((await cpuXCalendarQuoteContext(bookingId, { order: async () => order(), booking: async () => booking({ lifecycleStatus: "Cancelled" }) })).quote, undefined);
});

test("missing or cross-booking lineage fails closed and cycles have a hard read bound", async () => {
  let reads = 0;
  for (const value of [undefined, order({ sourceBookingId: "booking:other" }), order({ origin: "cpu_created" })]) {
    await assert.rejects(cpuXCalendarQuoteContext(bookingId, { order: async () => value, booking: async () => { throw Error("must not read"); } }), /could not be verified/);
  }
  await assert.rejects(cpuXCalendarQuoteContext(bookingId, { order: async () => { reads++; return order({ supersededBy: base }); }, booking: async () => booking() }), /cycle/);
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(cpuXCalendarQuoteContext(bookingId, { order: async id => { reads++; return order({ canonicalId: id, supersededBy: `${base}:r${reads + 1}` }); }, booking: async () => booking() }), /exceeds/);
  assert.equal(reads, 10);
});

test("OPLOC authorization resolves governed aliases and rejects cyclic or missing identity", () => {
  assert.equal(calendarQuoteOplocId("oploc:old", { "oploc:old": "oploc:current" }), "oploc:current");
  assert.throws(() => calendarQuoteOplocId("oploc:old", { "oploc:old": "oploc:old" }), /could not be resolved/);
  assert.throws(() => calendarQuoteOplocId("", {}), /could not be resolved/);
});

test("quote access requires CPU assignment and the resolved site; missing AUTHMOD state fails closed", async () => {
  const timestamp = "2026-11-03T00:00:00Z";
  const app: ApplicationRegistryEntry = { appId: "cpu-production", displayName: "CPU", enabled: true, launchVisible: true, scopeModel: "oploc", standardBundleId: "cpu-normal", standardResource: "cpu-production.normal", standardActions: ["View"], version: 1, createdAt: timestamp, updatedAt: timestamp, provenance: "migration" };
  const identity: AuthIdentity = { id: "quote-reader", displayName: "Test reader", identityKind: "person", identityLinkStatus: "matched", status: "active", fullAccess: false, provenance: "manual-override", version: 1, createdAt: timestamp, updatedAt: timestamp };
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: "person" };
  const repository = new MemoryAuthModRepository({ applications: [app], oplocs: [{ id: "oploc:site", label: "Site", active: true }, { id: "oploc:other", label: "Other", active: true }] });
  repository.identities.set(identity.id, identity);
  repository.listOplocRedirects = async () => ({ "oploc:old": "oploc:site" });
  await assert.rejects(assertCpuXCalendarQuoteAccess(repository, principal, "oploc:site"), { status: 403 });
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: app.appId, actor: principal, reason: "isolated quote access test" });
  await assert.rejects(assertCpuXCalendarQuoteAccess(repository, principal, "oploc:site"), { status: 403 });
  await assignSite(repository, { identityId: identity.id, oplocId: "oploc:site", actor: principal, reason: "isolated quote access test" });
  await assertCpuXCalendarQuoteAccess(repository, principal, "oploc:old");
  await assert.rejects(assertCpuXCalendarQuoteAccess(repository, principal, "oploc:other"), { status: 403 });
  await assert.rejects(assertCpuXCalendarQuoteAccess(repository, principal, "oploc:missing"), { status: 403 });
  repository.getIdentity = async () => { throw Error("AUTHMOD unavailable"); };
  await assert.rejects(assertCpuXCalendarQuoteAccess(repository, principal, "oploc:site"), { status: 503 });
});

test("HTTP quote read rejects anonymous callers before any upstream request", async t => {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../app/api/production/calendar-quote/route");
  let externalCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { externalCalls++; throw Error("External writes forbidden"); });
  const response = await GET(new NextRequest("http://localhost/api/production/calendar-quote?bookingId=booking:1"));
  assert.equal(response.status, 401);
  assert.equal(externalCalls, 0);
});
