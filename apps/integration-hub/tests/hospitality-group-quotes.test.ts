import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { generateHospitalityGroupQuote, type GroupQuoteArtifact, type GroupQuoteHead, type GroupQuoteStore, type HospitalityGroupQuote } from "../lib/hospitality-group-quote-workflow";
import { groupCommercialState, projectBookingGroup, validateBookingGroup } from "../lib/hospitality-group-commercial";
import { projectHospitalityGroups } from "../lib/hospitality-group-projection";
import { hospitalityGroupQuoteHtml } from "../lib/hospitality-group-quote-document";
import { groupQuoteDriveArtifact } from "../lib/hospitality-group-quote-artifact";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";

const GROUP = "RCOA-GROUP-TEST";
const at = "2026-10-15T10:00:00.000Z";
export const childrenFixture = (id = GROUP): CanonicalBooking[] => ["15:00", "09:00", "13:00", "11:00"].map((time, i) => ({
  canonicalId: `booking:${id}:${i + 1}`, entityType: "Booking", schemaVersion: "0.1.0", version: 1, lifecycleStatus: "New", createdAt: at, updatedAt: at, createdBy: "fixture", updatedBy: "fixture",
  source: { provider: "rcoa-booking-platform", sourceBookingId: `${id}-${i + 1}`, submissionTimestamp: at, contractVersion: "test", originalPayload: {} },
  bookingGroup: { id, size: 4, sequence: i + 1 }, client: { name: "Test Requester", email: "host@example.test", companyName: "FIKA", invoiceReference: "PO-22" }, service: { eventDate: "2026-11-05", startTime: time, guestCount: 25, roomOrArea: "Room 2", oplocId: "oploc:rcoa-test", portalSiteId: "rcoa" },
  // Deliberately different from today's unit-price multiplication: the recorded line total is authoritative.
  order: { eventType: ["meeting_hospitality", "breakfast", "lunch", "meeting_hospitality"][i], items: [{ itemId: `item-${i}`, itemName: `Service item ${i}`, quantity: 25, unitPrice: 999, lineTotal: (i + 1) * 10 }], netTotal: (i + 1) * 10, vatTotal: 0, grossTotal: (i + 1) * 10, currency: "GBP" },
  dietaries: { milk: "UNRECORDED" }, acknowledgements: {}, attachments: [], statusHistory: [], audit: [], commercialVersion: 1, quoteState: { revisions: [] }, deliveryChargeRequired: i === 1 || i === 2,
  notes: "Event: Annual lecture",
} as unknown as CanonicalBooking));

function harness(children = childrenFixture()) {
  let rows = new Map(children.map(c => [c.canonicalId, structuredClone(c)]));
  let heads = new Map<string, GroupQuoteHead>(); let quotes = new Map<string, HospitalityGroupQuote>(); let events = new Map<string, Record<string, unknown>>();
  let lock = Promise.resolve(); let failComplete = false; let failArtifact = false; let reserveCalls = 0; let uploads = 0;
  const files = new Map<string, string>();
  const store: GroupQuoteStore = { transaction: async run => {
    const prior = lock; let release!: () => void; lock = new Promise<void>(r => release = r); await prior;
    const nextRows = structuredClone(rows), nextHeads = structuredClone(heads), nextQuotes = structuredClone(quotes), nextEvents = structuredClone(events);
    try {
      const result = await run({ children: async id => [...nextRows.values()].filter(c => c.bookingGroup?.id === id), head: async id => nextHeads.get(id), quote: async id => nextQuotes.get(id), putHead: h => { nextHeads.set(h.bookingGroupId, h); }, putQuote: q => { nextQuotes.set(q.id, q); }, putChild: b => { nextRows.set(b.canonicalId, b); }, audit: (id, event) => { if (failComplete && event.action === "group-quote-completed") { failComplete = false; throw Error("Injected final commit failure"); } assert.ok(!nextEvents.has(id), "audit events are append-only"); nextEvents.set(id, event); } });
      rows = nextRows; heads = nextHeads; quotes = nextQuotes; events = nextEvents; return structuredClone(result);
    } finally { release(); }
  } };
  const artifact: GroupQuoteArtifact = { reserve: async () => { reserveCalls++; return `file-${reserveCalls}`; }, ensure: async q => {
    if (failArtifact) throw Error("Injected Drive failure");
    if (!files.has(q.artifact.fileId!)) { files.set(q.artifact.fileId!, q.sourceHash); uploads++; }
    return { fileId: q.artifact.fileId!, driveUrl: `https://drive.test/${q.artifact.fileId}` };
  } };
  const context = { actorId: "test-manager", store, artifact, authorize: async () => {}, target: async () => ({ folderId: "folder-1", oplocId: "oploc:rcoa-test" }) };
  const command = () => ({ bookingGroupId: GROUP, expectedVersion: heads.get(GROUP)?.version || 0, expectedSourceHash: groupCommercialState(GROUP, [...rows.values()]).sourceHash });
  return { context, command, rows: () => [...rows.values()], quotes: () => [...quotes.values()], heads: () => [...heads.values()], events: () => [...events.values()], files, counts: () => ({ uploads, reserveCalls }), failArtifact: (v: boolean) => { failArtifact = v; }, failCommit: () => { failComplete = true; }, mutate: (fn: (b: CanonicalBooking) => void) => { fn([...rows.values()][0]); }, corruptQuote: (fn: (q: HospitalityGroupQuote) => void) => { fn([...quotes.values()][0]); } };
}

test("four structured children form one top-level group; unrelated bookings remain separate", () => {
  const children = childrenFixture(); const unrelated = { ...children[0], canonicalId: "independent", bookingGroup: undefined };
  const projection = projectHospitalityGroups([...children, unrelated], []);
  assert.equal(projection.bookingGroups.length, 1); assert.equal(projection.dashboardBookings.length, 1); assert.equal(projection.dashboardBookings[0].canonicalId, "independent");
  const group = projection.bookingGroups[0]; assert.equal(group.services.length, 4); assert.deepEqual(group.services.map(s => s.time), ["09:00", "11:00", "13:00", "15:00"]); assert.equal(group.totals.gross, 100);
  assert.deepEqual(group.services.map(s => s.lines[0].net), [20, 40, 30, 10]);
  const sameDay = children.map(c => ({ ...c, bookingGroup: undefined })); assert.equal(projectHospitalityGroups(sameDay, []).dashboardBookings.length, 4);
});

test("incomplete/duplicate membership and shared-data conflicts fail closed without hiding services", () => {
  const children = childrenFixture();
  assert.throws(() => validateBookingGroup(GROUP, children.slice(1)), /incomplete/);
  assert.throws(() => validateBookingGroup(GROUP, [children[0], children[0], ...children.slice(2)]), /incomplete/);
  assert.throws(() => validateBookingGroup(GROUP, children.map((c, i) => i ? c : { ...c, client: { ...c.client, email: "other@example.test" } })), /conflict/);
  const result = projectHospitalityGroups(children.slice(1), []); assert.equal(result.bookingGroups.length, 0); assert.equal(result.dashboardBookings.length, 3); assert.equal(result.groupWarnings?.length, 1);
});

test("one immutable quote/version and artifact; replay preserves child revisions, statuses and routing", async () => {
  const h = harness(); const command = h.command(); const before = h.rows();
  const q = await generateHospitalityGroupQuote(command, h.context); assert.equal(q.status, "complete");
  const replay = await generateHospitalityGroupQuote(command, h.context); assert.equal(replay.id, q.id); assert.equal(h.quotes().length, 1); assert.equal(h.heads()[0].version, 1); assert.deepEqual(h.counts(), { uploads: 1, reserveCalls: 1 });
  assert.ok(h.rows().every(b => b.lifecycleStatus === "Quoted" && b.quoteState?.revisions.length === 1));
  assert.deepEqual(h.rows().map(b => b.deliveryChargeRequired), before.map(b => b.deliveryChargeRequired));
  assert.deepEqual(h.rows().map(b => b.service), before.map(b => b.service));
  assert.ok(h.rows().every(b => b.quoteState!.revisions[0].driveFileId === q.artifact.fileId));
  assert.equal(projectBookingGroup(GROUP, h.rows(), q, 1).status, "Awaiting routing");
  assert.equal(projectBookingGroup(GROUP, h.rows(), q, 1).quote?.stale, false);
  const html = hospitalityGroupQuoteHtml(q);
  for (const s of q.snapshots) { assert.ok(html.includes(s.order.lines[0].name)); assert.ok(html.includes(s.service.startTime)); }
  assert.equal((html.match(/Total to pay/g) || []).length, 1); assert.match(html, /£100\.00/); assert.match(html, /PO-22/); assert.match(html, /Annual lecture/);
});

test("artifact failure is durable and retry recovers the same snapshot, ID and revision without partially quoting", async () => {
  const h = harness(); h.failArtifact(true); const cmd = h.command();
  const failed = await generateHospitalityGroupQuote(cmd, h.context); assert.equal(failed.status, "failed"); assert.ok(failed.artifact.fileId);
  assert.ok(h.rows().every(b => b.lifecycleStatus === "New" && !b.quoteState?.currentRevisionId));
  h.failArtifact(false); const recovered = await generateHospitalityGroupQuote(cmd, h.context);
  assert.equal(recovered.status, "complete"); assert.equal(recovered.id, failed.id); assert.equal(recovered.artifact.fileId, failed.artifact.fileId); assert.deepEqual(recovered.snapshots, failed.snapshots); assert.equal(h.quotes().length, 1);
});

test("upload success followed by final commit failure recovers without another upload", async () => {
  const h = harness(); h.failCommit(); const cmd = h.command();
  const failed = await generateHospitalityGroupQuote(cmd, h.context); assert.equal(failed.status, "failed"); assert.equal(h.files.size, 1); assert.ok(h.rows().every(b => b.lifecycleStatus === "New"));
  const q = await generateHospitalityGroupQuote(cmd, h.context); assert.equal(q.status, "complete"); assert.equal(h.counts().uploads, 1); assert.equal(h.quotes().length, 1);
});

test("concurrent retries coalesce; a changed child prevents any child quote commit", async () => {
  const h = harness(); const cmd = h.command();
  await Promise.all([generateHospitalityGroupQuote(cmd, h.context), generateHospitalityGroupQuote(cmd, h.context)]);
  assert.equal(h.quotes().length, 1); assert.equal(h.counts().uploads, 1);
  const changed = harness(); const originalEnsure = changed.context.artifact.ensure;
  changed.context.artifact.ensure = async q => { changed.mutate(b => { b.commercialVersion = 2; b.order.items[0].lineTotal = 50; b.order.netTotal = 50; b.order.grossTotal = 50; }); return originalEnsure(q); };
  const superseded = await generateHospitalityGroupQuote(changed.command(), changed.context); assert.equal(superseded.status, "superseded"); assert.ok(changed.rows().every(b => b.lifecycleStatus === "New"));
});

test("stale intent/version or denied access produces no quote or external writes", async () => {
  const h = harness();
  await assert.rejects(generateHospitalityGroupQuote({ ...h.command(), expectedSourceHash: "0".repeat(64) }, h.context), /changed/);
  await assert.rejects(generateHospitalityGroupQuote({ ...h.command(), expectedVersion: 99 }, h.context), /version changed/);
  await assert.rejects(generateHospitalityGroupQuote(h.command(), { ...h.context, authorize: async () => { throw Error("Denied"); } }), /Denied/);
  assert.equal(h.quotes().length, 0); assert.equal(h.files.size, 0);
});

test("an expired lease can be recovered; late completion cannot duplicate or overwrite the recovered quote", async () => {
  const h = harness(); let time = new Date(at); let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => release = resolve); const started = new Promise<void>(resolve => entered = resolve);
  const original = h.context.artifact.ensure; let calls = 0;
  h.context.artifact.ensure = async q => { if (++calls === 1) { entered(); await waiting; } return original(q); };
  const context = { ...h.context, now: () => time }; const cmd = h.command();
  const interrupted = generateHospitalityGroupQuote(cmd, context); await started;
  const pending = await generateHospitalityGroupQuote(cmd, context); assert.equal(pending.status, "artifact_pending");
  time = new Date(Date.parse(at) + 181_000);
  const recovered = await generateHospitalityGroupQuote(cmd, context); assert.equal(recovered.status, "complete");
  release(); assert.equal((await interrupted).id, recovered.id); assert.equal(h.counts().uploads, 1); assert.equal(h.quotes().length, 1);
});

test("artifact integrity failure is terminal and never silently rebuilt on retry", async () => {
  const h = harness(); let ensures = 0;
  h.context.artifact.ensure = async () => { ensures++; throw Object.assign(Error("Corrupt artifact"), { integrityFailed: true }); };
  const cmd = h.command(); const failed = await generateHospitalityGroupQuote(cmd, h.context);
  assert.equal(failed.status, "integrity_failed");
  await generateHospitalityGroupQuote(cmd, h.context); assert.equal(ensures, 1); assert.ok(h.rows().every(b => b.lifecycleStatus === "New"));
});

test("a corrupted frozen snapshot fails closed before artifact creation", async () => {
  const h = harness(); h.failArtifact(true); const cmd = h.command();
  await generateHospitalityGroupQuote(cmd, h.context);
  h.corruptQuote(q => { q.snapshots[0].order.lines[0].lineNet.amount = 777; });
  h.failArtifact(false);
  const q = await generateHospitalityGroupQuote(cmd, h.context); assert.equal(q.status, "integrity_failed"); assert.equal(h.files.size, 0); assert.ok(h.rows().every(b => b.lifecycleStatus === "New"));
});

test("child lifecycle labels cannot bypass required routing and quote work", () => {
  const children = childrenFixture();
  const routing = Object.fromEntries(children.map((b, i) => [b.canonicalId, { status: i % 2 ? "cpu_required" : "no_cpu_production", statusLabel: i % 2 ? "CPU · Hospitality" : "In house", lines: [{ index: 0, state: i % 2 ? "cpu" : "in_house", label: "Test routing" }] }]));
  assert.equal(projectBookingGroup(GROUP, children).status, "Awaiting routing");
  children[0].lifecycleStatus = "Completed"; const mixed = projectBookingGroup(GROUP, children, undefined, 0, routing);
  assert.equal(mixed.status, "New"); assert.equal(mixed.routing.cpuServices, 2); assert.equal(mixed.routing.inHouseServices, 2);
  children.forEach(c => c.lifecycleStatus = "Cancelled"); assert.equal(projectBookingGroup(GROUP, children).status, "Cancelled");
  children.forEach(c => c.lifecycleStatus = "Completed"); assert.equal(projectBookingGroup(GROUP, children).status, "Awaiting routing");
});

test("current historical child snapshots and post-quote charges retain captured policy/amounts", async () => {
  const h = harness(); const first = await generateHospitalityGroupQuote(h.command(), h.context);
  h.mutate(b => { b.commercialVersion = 2; b.quoteState!.revisions[0].stale = true; b.additionalCharges = [{ id: "extra-123", kind: "manual", category: "equipment", label: "Table hire", quantity: 2, unitNet: 7.5, netTotal: 15, createdAt: at, createdBy: "test" }]; });
  const state = groupCommercialState(GROUP, h.rows()); assert.equal(state.totals.gross, first.totals.gross + 15);
  assert.equal(projectBookingGroup(GROUP, h.rows(), first).quote?.stale, true);
  const revised = await generateHospitalityGroupQuote(h.command(), h.context); assert.equal(revised.revision, 2); assert.equal(revised.totals.gross, 115); assert.equal(first.totals.gross, 100);
});

test("Drive adapter creates only the durable reserved ID; lost upload response is reconciled without render/reupload", async () => {
  const h = harness(); const q = await generateHospitalityGroupQuote(h.command(), h.context); let exists = false; let renders = 0; let creates = 0; let loseResponse = true;
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("upload/drive")) { creates++; assert.match(await (init!.body as Blob).text(), /"id":"file-1"/); exists = true; if (loseResponse) { loseResponse = false; throw Error("Response lost"); } return Response.json({ id: "file-1" }); }
    if (path.includes("/folder-1?")) return Response.json({ mimeType: "application/vnd.google-apps.folder" });
    return exists ? Response.json({ id: "file-1", mimeType: "application/pdf", size: "99", md5Checksum: q.artifact.pdfMd5, parents: ["folder-1"], appProperties: { fikaGroupQuoteSource: q.sourceHash } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  const adapter = groupQuoteDriveArtifact(fetcher, async () => { renders++; return Buffer.from("%PDF-test"); }, async () => ({ Authorization: "Bearer test" }));
  await assert.rejects(adapter.ensure(q, async md5 => { q.artifact.pdfMd5 = md5; }), /Response lost/);
  assert.equal((await adapter.ensure(q)).fileId, "file-1"); assert.equal(creates, 1); assert.equal(renders, 1);
  const corrupt = groupQuoteDriveArtifact(async () => Response.json({ id: "file-1", mimeType: "application/pdf", size: "99", parents: ["folder-1"], appProperties: { fikaGroupQuoteSource: "wrong" } }), async () => { throw Error("Must never render over corrupt existing file"); }, async () => ({ Authorization: "Bearer test" }));
  await assert.rejects(corrupt.ensure(q), /integrity verification failed/);
});

test("Firestore adapter commits all child quote sections together and replays one revision", { skip: !process.env.FIKA_GROUP_QUOTE_EMULATOR_TEST }, async () => {
  const { firestoreGroupQuoteStore } = await import("../lib/hospitality-group-quote-store");
  const { db } = await import("../lib/firebase-admin");
  const id = `group-${randomUUID()}`; const children = childrenFixture(id);
  children.forEach(c => { c.deliveryChargeRequired = true; c.order.items[0].itemId = `${id}-${c.order.items[0].itemId}`; });
  await Promise.all(children.map(b => db.collection("fikaBookings").doc(b.canonicalId).set(b)));
  const h = harness(children); const command = { bookingGroupId: id, expectedSourceHash: groupCommercialState(id, children).sourceHash, expectedVersion: 0 };
  const context = { ...h.context, store: firestoreGroupQuoteStore };
  const quote = await generateHospitalityGroupQuote(command, context); assert.equal(quote.status, "complete");
  await generateHospitalityGroupQuote(command, context);
  const saved = await db.collection("fikaBookings").where("bookingGroup.id", "==", id).get();
  assert.equal(saved.size, 4); assert.ok(saved.docs.every(d => d.data().lifecycleStatus === "Quoted" && d.data().quoteState.revisions.length === 1));
  assert.equal(h.counts().uploads, 1);
  // Group creation itself never schedules CPU work. Existing hand-off still accepts independent child sections.
  const { createProductionFromApprovedBooking } = await import("../lib/production-domain");
  const { stableDocumentId } = await import("../lib/canonical-editor");
  const { executeBookingWorkflow } = await import("../lib/hospitality-booking-service");
  const actor = { uid: "test-group-manager", role: "integration-admin" as const, email: "group@example.test", name: "Group test manager", synthetic: true };
  for (const [index, child] of children.entries()) {
    const before = await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", child.canonicalId).get(); assert.equal(before.size, 0);
    await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(`hospitality-menu-item:rcoa:${child.order.items[0].itemId}`)).set({ workstreams: index === 1 || index === 2 ? ["hospitality"] : [] });
  }
  const inHouse = await createProductionFromApprovedBooking(actor, children[0].canonicalId, `${id}:in-house`);
  assert.equal(inHouse.status, "no_cpu_production_required"); assert.equal(inHouse.order, undefined);
  const cpuA = await createProductionFromApprovedBooking(actor, children[1].canonicalId, `${id}:cpu-a`);
  const cpuB = await createProductionFromApprovedBooking(actor, children[2].canonicalId, `${id}:cpu-b`);
  assert.notEqual(cpuA.order!.canonicalId, cpuB.order!.canonicalId); assert.equal(cpuA.order!.sourceBookingId, children[1].canonicalId); assert.equal(cpuB.order!.sourceBookingId, children[2].canonicalId);
  assert.equal(cpuA.order!.serviceWindow!.startTime, children[1].service.startTime);
  const latest = (await db.collection("fikaBookings").doc(children[3].canonicalId).get()).data() as CanonicalBooking;
  await assert.rejects(executeBookingWorkflow(actor, latest.canonicalId, latest.version, { action: "quote" }), /consolidated quote/);
});

test("grouped RCoA quote uses the canonical Hospitality quote branding, not FIKA OS or a grouped-only style", async () => {
  const h = harness(); const q = await generateHospitalityGroupQuote(h.command(), h.context);
  const html = hospitalityGroupQuoteHtml(q);
  assert.doesNotMatch(html, /FIKA OS|wordmark/);
  assert.match(html, /<header class="masthead"><img class="logo" src="data:image\/png;base64,[^"]+" alt="FIKA" \/><img class="site-logo site-logo--reversed" src="data:image\/svg\+xml;base64,[^"]+" alt="RCoA" \/><\/header>/);
  assert.doesNotMatch(html, /<div class="masthead-label"/);
  assert.match(html, /font-family:Vim/); assert.match(html, /font-family:Gilroy/); assert.match(html, /<table class="order">/);
  assert.equal((html.match(/<section class="schedule-service">/g) || []).length, q.snapshots.length);
  const times = q.snapshots.map(s => html.indexOf(`${s.service.startTime} —`)); assert.ok(times.every(i => i > 0)); assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.equal((html.match(/Service subtotal \(net\)/g) || []).length, q.snapshots.length);
  assert.equal(hospitalityGroupQuoteHtml(q), html, "rendering is deterministic for the immutable group quote");
});
