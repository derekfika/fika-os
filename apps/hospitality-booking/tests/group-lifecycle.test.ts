import assert from "node:assert/strict";
import test from "node:test";
import { groupLifecycleStatus, type GroupCpuEvidence } from "../../shared/hospitality-group-lifecycle";
import type { HospitalityBookingGroup, HospitalityGroupService } from "../../shared/hospitality-group-quotes";
import { hydrateGroupProgress } from "../lib/group-progress";
import { planServiceProduction } from "../lib/cpu-production-plan";
import type { CanonicalBooking, ProductionOrder } from "../lib/canonical-types";

function service(id: string, cpu = true): HospitalityGroupService {
  return { bookingId: id, lifecycleStatus: cpu ? "Completed" : "Quoted", routing: { status: cpu ? "cpu_required" : "no_cpu_production", statusLabel: "Test", lines: [] }, ...(cpu ? { production: { orderId: `order:${id}`, version: 4, sourceRevision: 1, status: "accepted", quoteRevisionId: `quote:${id}`, quoteCurrent: true } } : {}) } as unknown as HospitalityGroupService;
}
const group = (services = [service("pastries"), service("coffee", false), service("lunch")]) => ({ services, status: "Sent to CPU", quote: { status: "complete", stale: false } }) as HospitalityBookingGroup;
const evidence = (id: string): GroupCpuEvidence => ({ orderId: `order:${id}`, planStatus: "planned", reviewed: true, matrixStatus: "ready", signatureRoles: ["production_chef", "head_chef_site_manager"], sourceLineage: { productionOrderId: `order:${id}`, sourceBookingId: id, sourceQuoteRevisionId: `quote:${id}`, sourceVersion: 1 } });
const complete = () => ({ "order:pastries": evidence("pastries"), "order:lunch": evidence("lunch") });

test("mixed quoted/completed children complete only from required CPU work and current signed release evidence", () => {
  assert.equal(groupLifecycleStatus(group(), complete()), "Completed");
  assert.equal(groupLifecycleStatus(group()), "Sent to CPU");
});
test("all explicitly No CPU services complete with current quote and no downstream requests", async () => {
  const g = group([service("coffee", false), service("room", false)]);
  assert.equal(groupLifecycleStatus(g), "Completed");
  let reads = 0;
  assert.equal((await hydrateGroupProgress([{ ...g, status: "Completed" }], async () => { reads++; return []; }))[0].status, "Completed");
  assert.equal(reads, 0);
});
test("missing templates and disabled customer emails never participate in required work", () => {
  assert.equal(groupLifecycleStatus({ ...group(), menuTemplatesConfigured: false, customerEmailEnabled: false } as HospitalityBookingGroup, complete()), "Completed");
});
test("partial CPU handoff remains partial; unsent CPU and unresolved routing cannot complete", () => {
  const g = group(); delete g.services[2].production;
  assert.equal(groupLifecycleStatus(g, complete()), "Partially processed");
  delete g.services[0].production;
  assert.equal(groupLifecycleStatus(g, complete()), "Ready for CPU");
  g.services[1].routing!.status = "routing_required";
  assert.equal(groupLifecycleStatus(g, complete()), "Awaiting routing");
  g.services[1].routing!.status = "routing_conflict";
  assert.equal(groupLifecycleStatus(g, complete()), "Awaiting routing");
});
test("failed handoff or materialisation needs attention and cannot become complete", () => {
  const g = group(); g.services[0].production!.status = "failed";
  assert.equal(groupLifecycleStatus(g, complete()), "Needs attention");
  const e = complete(); e["order:lunch"].matrixStatus = "failed";
  assert.equal(groupLifecycleStatus(group(), e), "Needs attention");
});
test("stale quotes, expired lineage, absent signatures, unfinished review and non-ready releases block completion", () => {
  const g = group(); g.quote!.stale = true;
  assert.equal(groupLifecycleStatus(g, complete()), "Awaiting quote");
  for (const mutate of [
    (e: GroupCpuEvidence) => { e.sourceLineage!.sourceQuoteRevisionId = "old"; },
    (e: GroupCpuEvidence) => { e.sourceLineage!.sourceVersion = 2; },
    (e: GroupCpuEvidence) => { e.sourceLineage!.sourceBookingId = "other-site-booking"; },
    (e: GroupCpuEvidence) => { e.reviewed = false; },
    (e: GroupCpuEvidence) => { e.signatureRoles.pop(); },
    (e: GroupCpuEvidence) => { e.matrixStatus = "generating"; },
    (e: GroupCpuEvidence) => { e.planStatus = "draft"; },
  ]) { const e = complete(); mutate(e["order:lunch"]); assert.notEqual(groupLifecycleStatus(group(), e), "Completed"); }
});
test("cancelled groups remain cancelled; mixed cancellation needs attention", () => {
  const g = group(); g.services.forEach(s => s.lifecycleStatus = "Cancelled");
  assert.equal(groupLifecycleStatus(g), "Cancelled"); g.services[0].lifecycleStatus = "Completed";
  assert.equal(groupLifecycleStatus(g, complete()), "Needs attention");
});
test("reload derives the same terminal state without persistence, and unavailable CPU fails closed", async () => {
  for (let reload = 0; reload < 2; reload++) assert.equal((await hydrateGroupProgress([group()], async ids => ids.map(id => complete()[id as keyof ReturnType<typeof complete>])))[0].status, "Completed");
  assert.equal((await hydrateGroupProgress([group()], async () => { throw Error("offline"); }))[0].status, "Needs attention");
  assert.equal((await hydrateGroupProgress([group()], async () => []))[0].status, "Needs attention");
  assert.equal((await hydrateGroupProgress([group()], async ids => ids.map(id => ({ ...complete()[id as keyof ReturnType<typeof complete>], signatureRoles: [], matrixStatus: undefined }))))[0].status, "Sent to CPU");
});
test("progress reads are deduplicated and bounded to 25 known required orders; no unrelated order can complete a group", async () => {
  const groups = Array.from({ length: 30 }, (_, i) => group([service(`b${i}`)]));
  const calls: string[][] = [];
  const updated = await hydrateGroupProgress(groups, async ids => { calls.push(ids); return ids.map(id => evidence(id.slice(6))); });
  assert.deepEqual(calls.map(c => c.length), [25, 5]);
  assert.ok(updated.every(g => g.status === "Completed"));
});
test("an amended booking cannot reuse a stale order or cached sent result/document linkage", () => {
  const booking = { canonicalId: "booking", lifecycleStatus: "Reviewed", commercialVersion: 2, order: { items: [{}] }, cpuRouting: { status: "cpu_required", enforced: true, lines: [{ state: "cpu_hospitality" }] }, quoteState: { currentRevisionId: "old", revisions: [{ id: "old", commercialVersion: 1, stale: true, pdfStatus: "saved", driveFileId: "old-file" }] } } as unknown as CanonicalBooking;
  const order = { sourceReferences: { quoteRevisionId: "old" } } as ProductionOrder;
  const row = planServiceProduction(booking, order, "Breakfast", { booking: { status: "sent" } });
  assert.equal(row.state, "awaiting_quote"); assert.equal(row.hasProductionOrder, false);
});
